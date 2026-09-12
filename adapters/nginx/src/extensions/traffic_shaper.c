#include "gateway.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void ngx_http_gateway_traffic_shaper_cleanup(void *data) {
  aurora_traffic_shaper_destroy(data);
}

char *ngx_http_gateway_merge_traffic_shaper(ngx_conf_t *cf,
                                            ngx_http_gateway_conf_t *prev,
                                            ngx_http_gateway_conf_t *conf) {
  ngx_pool_cleanup_t *cleanup;
  struct stat st;
  int fd;
  ssize_t n;
  size_t used = 0;
  u_char *bytes;
  uint32_t status;

  ngx_conf_merge_str_value(conf->traffic_shaper_policy,
                           prev->traffic_shaper_policy, "");
  if (conf->traffic_shaper_policy.len == 0) {
    return NGX_CONF_OK;
  }

  if (prev->traffic_shaper_engine &&
      conf->traffic_shaper_policy.data == prev->traffic_shaper_policy.data) {
    conf->traffic_shaper_engine = prev->traffic_shaper_engine;
    return NGX_CONF_OK;
  }
  if (ngx_conf_full_name(cf->cycle, &conf->traffic_shaper_policy, 0) !=
      NGX_OK) {
    return NGX_CONF_ERROR;
  }

  fd = open((char *)conf->traffic_shaper_policy.data, O_RDONLY | O_NONBLOCK);
  if (fd == -1) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno,
                       "cannot open Gateway traffic shaper policy %V",
                       &conf->traffic_shaper_policy);
    return NGX_CONF_ERROR;
  }
  if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
      st.st_size > 131072) {
    close(fd);
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "Gateway traffic shaper policy must be a regular file "
                       "of 1..131072 bytes");
    return NGX_CONF_ERROR;
  }
  bytes = ngx_pnalloc(cf->temp_pool, 131073);
  if (bytes == NULL) {
    close(fd);
    return NGX_CONF_ERROR;
  }
  while (used < 131073) {
    n = read(fd, bytes + used, 131073 - used);
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

  cleanup = ngx_pool_cleanup_add(cf->pool, 0);
  if (cleanup == NULL) {
    return NGX_CONF_ERROR;
  }
  status =
      aurora_traffic_shaper_create(bytes, used, &conf->traffic_shaper_engine);
  if (status != 0) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "invalid Gateway traffic shaper policy %V (status %ui)",
                       &conf->traffic_shaper_policy, (ngx_uint_t)status);
    return NGX_CONF_ERROR;
  }
  cleanup->handler = ngx_http_gateway_traffic_shaper_cleanup;
  cleanup->data = conf->traffic_shaper_engine;
  return NGX_CONF_OK;
}

ngx_int_t ngx_http_gateway_eval_traffic_shaper(ngx_http_request_t *r,
                                               ngx_http_gateway_conf_t *conf,
                                               ngx_str_t host) {
  if (!conf->traffic_shaper_engine) {
    return NGX_DECLINED;
  }

  ngx_str_t client_ip = r->connection->addr_text;
  if (client_ip.len == 0) {
    return NGX_DECLINED;
  }

  AuroraTrafficShaperDecision decision;
  ngx_memzero(&decision, sizeof(decision));

  uint32_t status = aurora_traffic_shaper_evaluate(
      conf->traffic_shaper_engine, host.data, host.len, r->uri.data, r->uri.len,
      client_ip.data, client_ip.len, r, ngx_http_gateway_header_lookup,
      &decision);
  if (status != 0) {
    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_ERR, &log, 0,
                  "Gateway traffic shaper eval failure: %ui",
                  (ngx_uint_t)status);
    return NGX_DECLINED;
  }

  if (decision.matched && decision.rate_bytes_per_sec > 0) {
    r->limit_rate = (size_t)decision.rate_bytes_per_sec;
    r->limit_rate_set = 1;
    r->limit_rate_after = (size_t)decision.burst_bytes;
    r->limit_rate_after_set = 1;
  }

  return NGX_DECLINED;
}
