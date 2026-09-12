#include "gateway.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

static void
ngx_http_gateway_access_cleanup(void *data)
{
    aurora_access_destroy(data);
}

/* Access snapshot loader owns its independent handle and cleanup boundary. */
char *
ngx_http_gateway_merge_access(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf)
{
    ngx_pool_cleanup_t *cleanup;
    struct stat st;
    int fd;
    ssize_t n;
    size_t used = 0;
    u_char *bytes;
    uint32_t status;

    ngx_conf_merge_str_value(conf->access_policy, prev->access_policy, "");
    if (conf->access_policy.len == 0) { return NGX_CONF_OK; }
    if (((ngx_http_core_loc_conf_t *) ngx_http_conf_get_module_loc_conf(cf, ngx_http_core_module))->satisfy == NGX_HTTP_SATISFY_ANY) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway access requires satisfy all");
        return NGX_CONF_ERROR;
    }
    if (prev->access_engine && conf->access_policy.data == prev->access_policy.data) {
        conf->access_engine = prev->access_engine;
        return NGX_CONF_OK;
    }

    /* Chuẩn hóa đường dẫn đầy đủ của file policy */
    if (ngx_conf_full_name(cf->cycle, &conf->access_policy, 0) != NGX_OK) { return NGX_CONF_ERROR; }

    /* Mở file policy dạng non-blocking, chỉ đọc */
    fd = open((char *) conf->access_policy.data, O_RDONLY|O_NONBLOCK);
    if (fd == -1) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno, "cannot open Gateway access policy %V", &conf->access_policy);
        return NGX_CONF_ERROR;
    }

    /* Kiểm tra file hợp lệ và giới hạn kích thước an toàn (1 byte .. 64KB) */
    if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 65536) {
        close(fd);
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway access policy must be a regular file of 1..65536 bytes");
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

    /* Gọi FFI tạo instance Rust AuroraAccessEngine từ bytes policy đã đọc */
    status = aurora_access_create(bytes, used, &conf->access_engine);
    if (status != 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "invalid Gateway access policy %V (status %ui)", &conf->access_policy, (ngx_uint_t) status);
        return NGX_CONF_ERROR;
    }

    cleanup->handler = ngx_http_gateway_access_cleanup;
    cleanup->data = conf->access_engine;
    return NGX_CONF_OK;
}

ngx_int_t
ngx_http_gateway_eval_access(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host)
{
    if (!conf->access_engine) {
        return NGX_DECLINED;
    }

    AuroraAccessInput input;
    input.ip = r->connection->addr_text.data;
    input.ip_len = r->connection->addr_text.len;
    input.host = host.data;
    input.host_len = host.len;
    input.path = r->uri.data;
    input.path_len = r->uri.len;
    input.method = r->method_name.data;
    input.method_len = r->method_name.len;
    input.now = (uint64_t) ngx_time();

    AuroraDecision decision;
    uint32_t status = aurora_access_evaluate(conf->access_engine, &input, &decision);
    if (status != 0 || decision.action > 1) {
        return NGX_HTTP_SERVICE_UNAVAILABLE;
    }
    if (decision.log_matches) {
        aurora_access_record_match(decision.generation, decision.rule_id, input.ip, input.ip_len);
    }
    if (decision.action == 1) {
        return NGX_HTTP_FORBIDDEN;
    }

    return NGX_DECLINED;
}
