#include "gateway.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

static time_t gateway_log_second;
static ngx_uint_t gateway_log_count;

static void
ngx_http_gateway_waf_cleanup(void *data)
{
    aurora_waf_destroy(data);
}

char *
ngx_http_gateway_merge_waf(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf)
{
    ngx_pool_cleanup_t *cleanup;
    struct stat st;
    int fd;
    ssize_t n;
    size_t used = 0;
    u_char *bytes;
    uint32_t status;

    if (!conf->enabled) {
        return NGX_CONF_OK;
    }

    /*
     * Yêu cầu cấu hình satisfy all: Ngăn chặn tình trạng bypass access-phase
     * nếu có module access khác cấu hình allow (ví dụ allow IP trong satisfy any).
     */
    if (((ngx_http_core_loc_conf_t *) ngx_http_conf_get_module_loc_conf(cf, ngx_http_core_module))->satisfy == NGX_HTTP_SATISFY_ANY) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway requires satisfy all to prevent access-phase bypass");
        return NGX_CONF_ERROR;
    }

    /* Bắt buộc phải chỉ định file policy khi bật Gateway WAF */
    if (conf->policy.len == 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "gateway on requires gateway_waf_policy");
        return NGX_CONF_ERROR;
    }

    /* Tái sử dụng instance engine nếu cùng trỏ tới cùng file policy của parent */
    if (prev->engine && conf->policy.data == prev->policy.data) {
        conf->engine = prev->engine;
        return NGX_CONF_OK;
    }

    /* Chuẩn hóa đường dẫn đầy đủ của file policy */
    if (ngx_conf_full_name(cf->cycle, &conf->policy, 0) != NGX_OK) { return NGX_CONF_ERROR; }

    /* Mở file policy dạng non-blocking, chỉ đọc */
    fd = open((char *) conf->policy.data, O_RDONLY|O_NONBLOCK);
    if (fd == -1) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno, "cannot open Gateway policy %V", &conf->policy);
        return NGX_CONF_ERROR;
    }

    /* Kiểm tra file hợp lệ và giới hạn kích thước an toàn (1 byte .. 64KB) */
    if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 65536) {
        close(fd);
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway policy must be a regular file of 1..65536 bytes");
        return NGX_CONF_ERROR;
    }

    /* Cấp phát bộ nhớ tạm từ pool để đọc nội dung file policy */
    bytes = ngx_pnalloc(cf->temp_pool, 65537);
    if (bytes == NULL) { close(fd); return NGX_CONF_ERROR; }

    /* Đọc toàn bộ nội dung file policy, xử lý ngắt tín hiệu EINTR */
    while (used < 65537) {
        n = read(fd, bytes + used, 65537 - used);
        if (n == -1 && errno == EINTR) { continue; }
        if (n <= 0) { break; }
        used += (size_t) n;
    }
    close(fd);
    if (n < 0 || used != (size_t) st.st_size) { return NGX_CONF_ERROR; }

    /* Đăng ký cleanup handler để giải phóng Rust engine khi pool NGINX bị hủy */
    cleanup = ngx_pool_cleanup_add(cf->pool, 0);
    if (cleanup == NULL) { return NGX_CONF_ERROR; }

    /* Gọi FFI tạo instance Rust AuroraEngine từ bytes policy đã đọc */
    status = aurora_waf_create(bytes, used, &conf->engine);
    if (status != 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "invalid Gateway policy %V (status %ui)", &conf->policy, (ngx_uint_t) status);
        return NGX_CONF_ERROR;
    }



    cleanup->handler = ngx_http_gateway_waf_cleanup;
    cleanup->data = conf->engine;
    return NGX_CONF_OK;
}

ngx_int_t
ngx_http_gateway_eval_waf(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host)
{
    if (!conf->enabled) {
        return NGX_DECLINED;
    }

    AuroraDecision decision;
    uint32_t status = aurora_waf_evaluate_v4(conf->engine, host.data, host.len, r->uri.data, r->uri.len, &decision);
    if (status != 0 || decision.action > 1) {
        /*
         * Xử lý lỗi engine / panic:
         * Xóa log.handler tạm thời để tránh rò rỉ query/request nhạy cảm vào access log NGINX.
         */
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Gateway WAF evaluation failed: %ui", (ngx_uint_t) status);
        return NGX_HTTP_SERVICE_UNAVAILABLE;
    }

    /* Action = 1 (Block/Vi phạm rule) */
    if (gateway_log_second != ngx_time()) {
        gateway_log_second = ngx_time();
        gateway_log_count = 0;
    }
    if (decision.log_matches != 0 && gateway_log_count < 100) {
        gateway_log_count++;
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_INFO, &log, 0, "Gateway match generation=%uL rule=%uL score=%ui logs=%ui",
                      decision.generation, decision.rule_id, (ngx_uint_t) decision.score, (ngx_uint_t) decision.log_matches);
    }
    if (decision.action == 1) {
        /* Chế độ Audit: Chỉ ghi log cảnh báo, không chặn request */
        if (conf->mode == 1) {
            ngx_log_t log = *r->connection->log;
            log.handler = NULL;
            ngx_log_error(NGX_LOG_NOTICE, &log, 0, "Gateway audit: would block normalized path");
            return NGX_DECLINED;
        }
        /* Chế độ Enforce: Trả về 403 Forbidden để chặn request */
        return NGX_HTTP_FORBIDDEN;
    }

    return NGX_DECLINED;
}
