#include "gateway.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void ngx_http_gateway_request_mirror_cleanup(void *data) {
  aurora_request_mirror_destroy(data);
}

char *ngx_http_gateway_merge_request_mirror(ngx_conf_t *cf,
                                            ngx_http_gateway_conf_t *prev,
                                            ngx_http_gateway_conf_t *conf) {
  ngx_pool_cleanup_t *cleanup;
  struct stat st;
  int fd;
  ssize_t n;
  size_t used = 0;
  u_char *bytes;
  uint32_t status;

  ngx_conf_merge_str_value(conf->request_mirror_policy,
                           prev->request_mirror_policy, "");
  if (conf->request_mirror_policy.len == 0) {
    return NGX_CONF_OK;
  }

  if (prev->request_mirror_engine &&
      conf->request_mirror_policy.data == prev->request_mirror_policy.data) {
    conf->request_mirror_engine = prev->request_mirror_engine;
    return NGX_CONF_OK;
  }
  if (ngx_conf_full_name(cf->cycle, &conf->request_mirror_policy, 0) !=
      NGX_OK) {
    return NGX_CONF_ERROR;
  }

  fd = open((char *)conf->request_mirror_policy.data, O_RDONLY | O_NONBLOCK);
  if (fd == -1) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno,
                       "cannot open Gateway request mirror policy %V",
                       &conf->request_mirror_policy);
    return NGX_CONF_ERROR;
  }
  if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
      st.st_size > 131072) {
    close(fd);
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "Gateway request mirror policy must be a regular file "
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
  status = aurora_request_mirror_create(
      bytes, used, (AuroraRequestMirrorEngine **)&conf->request_mirror_engine);
  if (status != 0) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "invalid Gateway request mirror policy %V (status %ui)",
                       &conf->request_mirror_policy, (ngx_uint_t)status);
    return NGX_CONF_ERROR;
  }
  cleanup->handler = ngx_http_gateway_request_mirror_cleanup;
  cleanup->data = conf->request_mirror_engine;
  return NGX_CONF_OK;
}

ngx_int_t ngx_http_gateway_eval_request_mirror(ngx_http_request_t *r,
                                               ngx_http_gateway_conf_t *conf,
                                               ngx_str_t host) {
  if (!conf || !conf->request_mirror_engine) {
    return NGX_DECLINED;
  }

  /* Subrequests should inherit main request mirror decision without re-evaluating */
  if (r != r->main) {
    return NGX_DECLINED;
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx == NULL) {
    ctx = ngx_pcalloc(r->pool, sizeof(ngx_http_gateway_ctx_t));
    if (ctx == NULL) {
      return NGX_DECLINED;
    }
    ngx_http_set_ctx(r, ctx, ngx_http_gateway_module);
  }

  AuroraMirrorDecision decision;
  ngx_memzero(&decision, sizeof(decision));

  uint32_t random_seed = (uint32_t)ngx_random();
  ngx_str_t method = r->method_name;

  uint32_t status = aurora_request_mirror_evaluate(
      conf->request_mirror_engine, host.data, host.len, r->uri.data, r->uri.len,
      method.data, method.len, random_seed, &decision);

  if (status != 0) {
    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_ERR, &log, 0,
                  "Gateway request mirror eval failure: %ui",
                  (ngx_uint_t)status);
    return NGX_DECLINED;
  }

  if (decision.matched) {
    /* If upstream was not previously assigned, assign primary upstream */
    if (ctx->chosen_upstream.len == 0 && decision.primary_upstream_len > 0) {
      u_char *primary = ngx_pnalloc(r->pool, decision.primary_upstream_len);
      if (primary != NULL) {
        ngx_memcpy(primary, decision.primary_upstream,
                   decision.primary_upstream_len);
        ctx->chosen_upstream.data = primary;
        ctx->chosen_upstream.len = decision.primary_upstream_len;
      }
    }

    if (decision.rule_id_len > 0 && ctx->rule_id.len == 0) {
      u_char *rid = ngx_pnalloc(r->pool, decision.rule_id_len);
      if (rid != NULL) {
        ngx_memcpy(rid, decision.rule_id, decision.rule_id_len);
        ctx->rule_id.data = rid;
        ctx->rule_id.len = decision.rule_id_len;
      }
    }

    ctx->is_mirrored = decision.is_mirrored;
    ctx->evaluated = 1;

    if (decision.is_mirrored && decision.mirror_upstream_len > 0) {
      u_char *mirror = ngx_pnalloc(r->pool, decision.mirror_upstream_len);
      if (mirror != NULL) {
        ngx_memcpy(mirror, decision.mirror_upstream,
                   decision.mirror_upstream_len);
        ctx->mirror_upstream.data = mirror;
        ctx->mirror_upstream.len = decision.mirror_upstream_len;
      }

      /* Forward custom mirror headers */
      for (uint32_t i = 0; i < decision.headers_count && i < 16; i++) {
        if (decision.headers[i].name_len == 0) {
          continue;
        }

        ngx_table_elt_t *h = ngx_list_push(&r->headers_in.headers);
        if (h == NULL) {
          continue;
        }

        u_char *k = ngx_pnalloc(r->pool, decision.headers[i].name_len);
        u_char *val = ngx_pnalloc(r->pool, decision.headers[i].value_len);
        if (k == NULL || val == NULL) {
          continue;
        }

        ngx_memcpy(k, decision.headers[i].name, decision.headers[i].name_len);
        ngx_memcpy(val, decision.headers[i].value,
                   decision.headers[i].value_len);

        h->hash = 1;
        h->key.len = decision.headers[i].name_len;
        h->key.data = k;
        h->value.len = decision.headers[i].value_len;
        h->value.data = val;
        h->lowcase_key = k;
      }

      ngx_log_t log = *r->connection->log;
      log.handler = NULL;
      ngx_log_error(NGX_LOG_INFO, &log, 0,
                    "Gateway request mirror: rule %*s -> primary %V, mirror %V "
                    "(mirrored=1)",
                    (int)decision.rule_id_len, decision.rule_id,
                    &ctx->chosen_upstream, &ctx->mirror_upstream);
    }
  }

  return NGX_DECLINED;
}

ngx_int_t ngx_http_gateway_variable_mirror_upstream(
    ngx_http_request_t *r, ngx_http_variable_value_t *v, uintptr_t data) {
  (void)data;
  ngx_http_request_t *target_r = (r->main != NULL) ? r->main : r;
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(target_r, ngx_http_gateway_module);
  if (conf == NULL) {
    v->not_found = 1;
    return NGX_OK;
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(target_r, ngx_http_gateway_module);
  if (ctx == NULL || !ctx->evaluated) {
    ngx_str_t host = target_r->headers_in.server;
    if (host.len == 0) {
      ngx_http_core_srv_conf_t *server =
          ngx_http_get_module_srv_conf(target_r, ngx_http_core_module);
      host = server->server_name;
    }
    (void)ngx_http_gateway_eval_request_mirror(target_r, conf, host);
    ctx = ngx_http_get_module_ctx(target_r, ngx_http_gateway_module);
  }

  if (ctx != NULL && ctx->is_mirrored && ctx->mirror_upstream.len > 0) {
    v->len = ctx->mirror_upstream.len;
    v->data = ctx->mirror_upstream.data;
    v->valid = 1;
    v->no_cacheable = 1;
    v->not_found = 0;
    return NGX_OK;
  }

  v->not_found = 1;
  return NGX_OK;
}

ngx_int_t ngx_http_gateway_variable_mirror_status(ngx_http_request_t *r,
                                                  ngx_http_variable_value_t *v,
                                                  uintptr_t data) {
  (void)data;
  ngx_http_request_t *target_r = (r->main != NULL) ? r->main : r;
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(target_r, ngx_http_gateway_module);
  if (conf == NULL) {
    v->not_found = 1;
    return NGX_OK;
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(target_r, ngx_http_gateway_module);
  if (ctx == NULL || !ctx->evaluated) {
    ngx_str_t host = target_r->headers_in.server;
    if (host.len == 0) {
      ngx_http_core_srv_conf_t *server =
          ngx_http_get_module_srv_conf(target_r, ngx_http_core_module);
      host = server->server_name;
    }
    (void)ngx_http_gateway_eval_request_mirror(target_r, conf, host);
    ctx = ngx_http_get_module_ctx(target_r, ngx_http_gateway_module);
  }

  if (ctx != NULL && ctx->evaluated) {
    if (ctx->is_mirrored) {
      v->len = sizeof("mirrored") - 1;
      v->data = (u_char *)"mirrored";
    } else {
      v->len = sizeof("bypassed") - 1;
      v->data = (u_char *)"bypassed";
    }
    v->valid = 1;
    v->no_cacheable = 1;
    v->not_found = 0;
    return NGX_OK;
  }

  v->not_found = 1;
  return NGX_OK;
}
