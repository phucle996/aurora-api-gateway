#include "gateway.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void ngx_http_gateway_traffic_split_cleanup(void *data) {
  aurora_traffic_split_destroy(data);
}

char *ngx_http_gateway_merge_traffic_split(ngx_conf_t *cf,
                                           ngx_http_gateway_conf_t *prev,
                                           ngx_http_gateway_conf_t *conf) {
  ngx_pool_cleanup_t *cleanup;
  struct stat st;
  int fd;
  ssize_t n;
  size_t used = 0;
  u_char *bytes;
  uint32_t status;

  ngx_conf_merge_str_value(conf->traffic_split_policy,
                           prev->traffic_split_policy, "");
  if (conf->traffic_split_policy.len == 0) {
    return NGX_CONF_OK;
  }

  if (prev->traffic_split_engine &&
      conf->traffic_split_policy.data == prev->traffic_split_policy.data) {
    conf->traffic_split_engine = prev->traffic_split_engine;
    return NGX_CONF_OK;
  }
  if (ngx_conf_full_name(cf->cycle, &conf->traffic_split_policy, 0) != NGX_OK) {
    return NGX_CONF_ERROR;
  }

  fd = open((char *)conf->traffic_split_policy.data, O_RDONLY | O_NONBLOCK);
  if (fd == -1) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno,
                       "cannot open Gateway traffic split policy %V",
                       &conf->traffic_split_policy);
    return NGX_CONF_ERROR;
  }
  if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
      st.st_size > 131072) {
    close(fd);
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "Gateway traffic split policy must be a regular file of "
                       "1..131072 bytes");
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
  status = aurora_traffic_split_create(
      bytes, used, (AuroraTrafficSplitEngine **)&conf->traffic_split_engine);
  if (status != 0) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "invalid Gateway traffic split policy %V (status %ui)",
                       &conf->traffic_split_policy, (ngx_uint_t)status);
    return NGX_CONF_ERROR;
  }
  cleanup->handler = ngx_http_gateway_traffic_split_cleanup;
  cleanup->data = conf->traffic_split_engine;
  return NGX_CONF_OK;
}

ngx_int_t ngx_http_gateway_eval_traffic_split(ngx_http_request_t *r,
                                              ngx_http_gateway_conf_t *conf,
                                              ngx_str_t host) {
  if (!conf || !conf->traffic_split_engine) {
    return NGX_DECLINED;
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx != NULL && ctx->evaluated) {
    return NGX_DECLINED;
  }

  if (ctx == NULL) {
    ctx = ngx_pcalloc(r->pool, sizeof(ngx_http_gateway_ctx_t));
    if (ctx == NULL) {
      return NGX_DECLINED;
    }
    ngx_http_set_ctx(r, ctx, ngx_http_gateway_module);
  }
  ctx->evaluated = 1;

  ngx_str_t client_ip = r->connection->addr_text;
  if (client_ip.len == 0) {
    return NGX_DECLINED;
  }

  uint32_t random_seed = (uint32_t)ngx_random();

  AuroraTrafficSplitDecision decision;
  ngx_memzero(&decision, sizeof(decision));

  uint32_t status = aurora_traffic_split_evaluate(
      conf->traffic_split_engine, host.data, host.len, r->uri.data, r->uri.len,
      client_ip.data, client_ip.len, random_seed, r,
      ngx_http_gateway_header_lookup, &decision);

  if (status != 0) {
    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_ERR, &log, 0,
                  "Gateway traffic split eval failure: %ui",
                  (ngx_uint_t)status);
    return NGX_DECLINED;
  }

  if (decision.matched && decision.upstream_len > 0) {
    u_char *up = ngx_pnalloc(r->pool, decision.upstream_len);
    if (up == NULL) {
      return NGX_DECLINED;
    }
    ngx_memcpy(up, decision.upstream, decision.upstream_len);
    ctx->chosen_upstream.data = up;
    ctx->chosen_upstream.len = decision.upstream_len;

    if (decision.rule_id_len > 0) {
      u_char *rid = ngx_pnalloc(r->pool, decision.rule_id_len);
      if (rid != NULL) {
        ngx_memcpy(rid, decision.rule_id, decision.rule_id_len);
        ctx->rule_id.data = rid;
        ctx->rule_id.len = decision.rule_id_len;
      }
    }

    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(
        NGX_LOG_INFO, &log, 0, "Gateway traffic split: rule %*s -> upstream %V",
        (int)decision.rule_id_len, decision.rule_id, &ctx->chosen_upstream);
  }

  return NGX_DECLINED;
}

ngx_int_t ngx_http_gateway_variable_upstream(ngx_http_request_t *r,
                                             ngx_http_variable_value_t *v,
                                             uintptr_t data) {
  (void)data;
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  if (conf == NULL) {
    v->not_found = 1;
    return NGX_OK;
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx == NULL || !ctx->evaluated) {
    ngx_str_t host = r->headers_in.server;
    if (host.len == 0) {
      ngx_http_core_srv_conf_t *server =
          ngx_http_get_module_srv_conf(r, ngx_http_core_module);
      host = server->server_name;
    }
    (void)ngx_http_gateway_eval_traffic_split(r, conf, host);
    ctx = ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  }

  if (ctx != NULL && ctx->chosen_upstream.len > 0) {
    v->len = ctx->chosen_upstream.len;
    v->data = ctx->chosen_upstream.data;
    v->valid = 1;
    v->no_cacheable = 1;
    v->not_found = 0;
    return NGX_OK;
  }

  v->not_found = 1;
  return NGX_OK;
}

ngx_int_t ngx_http_gateway_variable_split_rule(ngx_http_request_t *r,
                                               ngx_http_variable_value_t *v,
                                               uintptr_t data) {
  (void)data;
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  if (conf == NULL) {
    v->not_found = 1;
    return NGX_OK;
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx == NULL || !ctx->evaluated) {
    ngx_str_t host = r->headers_in.server;
    if (host.len == 0) {
      ngx_http_core_srv_conf_t *server =
          ngx_http_get_module_srv_conf(r, ngx_http_core_module);
      host = server->server_name;
    }
    (void)ngx_http_gateway_eval_traffic_split(r, conf, host);
    ctx = ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  }

  if (ctx != NULL && ctx->rule_id.len > 0) {
    v->len = ctx->rule_id.len;
    v->data = ctx->rule_id.data;
    v->valid = 1;
    v->no_cacheable = 1;
    v->not_found = 0;
    return NGX_OK;
  }

  v->not_found = 1;
  return NGX_OK;
}
