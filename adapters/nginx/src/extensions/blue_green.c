#include "gateway.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void ngx_http_gateway_blue_green_cleanup(void *data) {
  aurora_blue_green_destroy(data);
}

char *ngx_http_gateway_merge_blue_green(ngx_conf_t *cf,
                                        ngx_http_gateway_conf_t *prev,
                                        ngx_http_gateway_conf_t *conf) {
  ngx_pool_cleanup_t *cleanup;
  struct stat st;
  int fd;
  ssize_t n;
  size_t used = 0;
  u_char *bytes;
  uint32_t status;

  ngx_conf_merge_str_value(conf->blue_green_policy,
                           prev->blue_green_policy, "");
  if (conf->blue_green_policy.len == 0) {
    return NGX_CONF_OK;
  }

  if (prev->blue_green_engine &&
      conf->blue_green_policy.data == prev->blue_green_policy.data) {
    conf->blue_green_engine = prev->blue_green_engine;
    return NGX_CONF_OK;
  }
  if (ngx_conf_full_name(cf->cycle, &conf->blue_green_policy, 0) !=
      NGX_OK) {
    return NGX_CONF_ERROR;
  }

  fd = open((char *)conf->blue_green_policy.data, O_RDONLY | O_NONBLOCK);
  if (fd == -1) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno,
                       "cannot open Gateway blue-green policy %V",
                       &conf->blue_green_policy);
    return NGX_CONF_ERROR;
  }
  if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
      st.st_size > 131072) {
    close(fd);
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "Gateway blue-green policy must be a regular file "
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
  status = aurora_blue_green_create(
      bytes, used, (AuroraBlueGreenEngine **)&conf->blue_green_engine);
  if (status != 0) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "invalid Gateway blue-green policy %V (status %ui)",
                       &conf->blue_green_policy, (ngx_uint_t)status);
    return NGX_CONF_ERROR;
  }
  cleanup->handler = ngx_http_gateway_blue_green_cleanup;
  cleanup->data = conf->blue_green_engine;
  return NGX_CONF_OK;
}

ngx_int_t ngx_http_gateway_eval_blue_green(ngx_http_request_t *r,
                                           ngx_http_gateway_conf_t *conf,
                                           ngx_str_t host) {
  if (!conf || !conf->blue_green_engine) {
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

  AuroraBlueGreenDecision decision;
  ngx_memzero(&decision, sizeof(decision));

  uint32_t status = aurora_blue_green_evaluate(
      conf->blue_green_engine, host.data, host.len, r->uri.data, r->uri.len,
      r, ngx_http_gateway_header_lookup, &decision);

  if (status != 0) {
    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_ERR, &log, 0,
                  "Gateway blue-green eval failure: %ui",
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

    if (decision.active_slot_len > 0) {
      u_char *slot = ngx_pnalloc(r->pool, decision.active_slot_len);
      if (slot != NULL) {
        ngx_memcpy(slot, decision.active_slot, decision.active_slot_len);
        ctx->deploy_slot.data = slot;
        ctx->deploy_slot.len = decision.active_slot_len;
      }
    }

    ctx->is_header_override = decision.is_header_override;
    ctx->evaluated = 1;

    /* Forward upstream headers */
    for (uint32_t i = 0; i < decision.headers_count && i < 16; i++) {
      if (decision.headers[i].name_len == 0) {
        continue;
      }
      ngx_table_elt_t *h = ngx_list_push(&r->headers_in.headers);
      if (h == NULL) {
        break;
      }
      h->hash = 1;
      h->key.len = decision.headers[i].name_len;
      h->key.data = ngx_pnalloc(r->pool, h->key.len);
      if (h->key.data == NULL) {
        break;
      }
      ngx_memcpy(h->key.data, decision.headers[i].name, h->key.len);

      h->value.len = decision.headers[i].value_len;
      h->value.data = ngx_pnalloc(r->pool, h->value.len);
      if (h->value.data == NULL) {
        break;
      }
      ngx_memcpy(h->value.data, decision.headers[i].value, h->value.len);

      h->lowcase_key = ngx_pnalloc(r->pool, h->key.len);
      if (h->lowcase_key != NULL) {
        ngx_strlow(h->lowcase_key, h->key.data, h->key.len);
      }
    }

    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_INFO, &log, 0,
                  "Gateway blue-green: rule %*s -> upstream %V (slot=%V, override=%ui)",
                  (int)decision.rule_id_len, decision.rule_id,
                  &ctx->chosen_upstream, &ctx->deploy_slot,
                  (ngx_uint_t)decision.is_header_override);
  }

  return NGX_DECLINED;
}

ngx_int_t ngx_http_gateway_variable_deploy_slot(ngx_http_request_t *r,
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
    (void)ngx_http_gateway_eval_blue_green(r, conf, host);
    ctx = ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  }

  if (ctx != NULL && ctx->deploy_slot.len > 0) {
    v->len = ctx->deploy_slot.len;
    v->data = ctx->deploy_slot.data;
    v->valid = 1;
    v->no_cacheable = 1;
    v->not_found = 0;
    return NGX_OK;
  }

  v->not_found = 1;
  return NGX_OK;
}
