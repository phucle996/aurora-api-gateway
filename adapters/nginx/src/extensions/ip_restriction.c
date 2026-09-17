#include "gateway.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void ngx_http_gateway_ip_restriction_cleanup(void *data) {
  aurora_ip_restriction_destroy(data);
}

/* IP Restriction snapshot loader owns its independent handle and cleanup boundary. */
char *ngx_http_gateway_merge_ip_restriction(ngx_conf_t *cf,
                                            ngx_http_gateway_conf_t *prev,
                                            ngx_http_gateway_conf_t *conf) {
  ngx_pool_cleanup_t *cleanup;
  struct stat st;
  int fd;
  ssize_t n;
  size_t used = 0;
  u_char *bytes;
  uint32_t status;

  ngx_conf_merge_str_value(conf->ip_restriction_policy, prev->ip_restriction_policy, "");
  if (conf->ip_restriction_policy.len == 0) {
    return NGX_CONF_OK;
  }
  if (((ngx_http_core_loc_conf_t *)ngx_http_conf_get_module_loc_conf(
           cf, ngx_http_core_module))
          ->satisfy == NGX_HTTP_SATISFY_ANY) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "Gateway IP restriction requires satisfy all");
    return NGX_CONF_ERROR;
  }
  if (prev->ip_restriction_engine &&
      conf->ip_restriction_policy.data == prev->ip_restriction_policy.data) {
    conf->ip_restriction_engine = prev->ip_restriction_engine;
    return NGX_CONF_OK;
  }

  /* Chuẩn hóa đường dẫn đầy đủ của file policy */
  if (ngx_conf_full_name(cf->cycle, &conf->ip_restriction_policy, 0) != NGX_OK) {
    return NGX_CONF_ERROR;
  }

  /* Mở file policy dạng non-blocking, chỉ đọc */
  fd = open((char *)conf->ip_restriction_policy.data, O_RDONLY | O_NONBLOCK);
  if (fd == -1) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno,
                       "cannot open Gateway IP restriction policy %V",
                       &conf->ip_restriction_policy);
    return NGX_CONF_ERROR;
  }

  /* Kiểm tra file hợp lệ và giới hạn kích thước an toàn (1 byte .. 64KB) */
  if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
      st.st_size > 65536) {
    close(fd);
    ngx_conf_log_error(
        NGX_LOG_EMERG, cf, 0,
        "Gateway IP restriction policy must be a regular file of 1..65536 bytes");
    return NGX_CONF_ERROR;
  }

  /* Cấp phát bộ nhớ tạm từ pool để đọc nội dung file policy */
  bytes = ngx_pnalloc(cf->temp_pool, 65537);
  if (bytes == NULL) {
    close(fd);
    return NGX_CONF_ERROR;
  }

  /* Đọc toàn bộ nội dung file policy, xử lý ngắt tín hiệu EINTR */
  while (used < 65537) {
    n = read(fd, bytes + used, 65537 - used);
    if (n == -1 && errno == EINTR) {
      continue;
    }
    if (n <= 0) {
      break;
    }
    used += (size_t)n;
  }
  close(fd);
  if (n < 0 || used != (size_t)st.st_size) {
    return NGX_CONF_ERROR;
  }

  /* Đăng ký cleanup handler để giải phóng Rust engine khi pool NGINX bị hủy */
  cleanup = ngx_pool_cleanup_add(cf->pool, 0);
  if (cleanup == NULL) {
    return NGX_CONF_ERROR;
  }

  /* Gọi FFI tạo instance Rust AuroraIpRestrictionEngine từ bytes policy đã đọc */
  status = aurora_ip_restriction_create(bytes, used, &conf->ip_restriction_engine);
  if (status != 0) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "invalid Gateway IP restriction policy %V (status %ui)",
                       &conf->ip_restriction_policy, (ngx_uint_t)status);
    return NGX_CONF_ERROR;
  }

  cleanup->handler = ngx_http_gateway_ip_restriction_cleanup;
  cleanup->data = conf->ip_restriction_engine;
  return NGX_CONF_OK;
}

ngx_int_t ngx_http_gateway_eval_ip_restriction(ngx_http_request_t *r,
                                               ngx_http_gateway_conf_t *conf,
                                               ngx_str_t host) {
  if (!conf->ip_restriction_engine) {
    return NGX_DECLINED;
  }

  AuroraIpRestrictionInput input;
  input.ip = r->connection->addr_text.data;
  input.ip_len = r->connection->addr_text.len;
  input.host = host.data;
  input.host_len = host.len;
  input.path = r->uri.data;
  input.path_len = r->uri.len;
  input.method = r->method_name.data;
  input.method_len = r->method_name.len;
  input.now = (uint64_t)ngx_time();

  AuroraDecision decision;
  uint32_t status =
      aurora_ip_restriction_evaluate(conf->ip_restriction_engine, &input, &decision);
  if (status != 0 || decision.action > 1) {
    return NGX_HTTP_SERVICE_UNAVAILABLE;
  }
  if (decision.action == 1) {
    aurora_gateway_record_ip_restriction(1);
    return NGX_HTTP_FORBIDDEN;
  }

  aurora_gateway_record_ip_restriction(0);
  return NGX_DECLINED;
}
