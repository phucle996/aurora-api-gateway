#include "gateway.h"

ngx_shm_zone_t *gateway_telemetry_zone;

/* Telemetry alone is shared across workers/reloads. Policy handles stay COW. */
ngx_int_t ngx_http_gateway_telemetry_zone_init(ngx_shm_zone_t *zone,
                                               void *previous) {
  ngx_slab_pool_t *pool = (ngx_slab_pool_t *)zone->shm.addr;
  if (previous) {
    zone->data = previous;
    return NGX_OK;
  }
  if (zone->shm.exists) {
    zone->data = pool->data;
    return NGX_OK;
  }
  zone->data = ngx_slab_calloc(pool, 64);
  if (!zone->data) {
    return NGX_ERROR;
  }
  pool->data = zone->data;
  return NGX_OK;
}

static ngx_int_t ngx_http_gateway_generation(ngx_http_request_t *r,
                                             ngx_http_variable_value_t *v,
                                             uintptr_t data) {
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  u_char *p;

  if (!conf) {
    return NGX_ERROR;
  }

  p = ngx_pnalloc(r->pool, NGX_INT64_LEN);
  if (p == NULL) {
    return NGX_ERROR;
  }
  v->len =
      ngx_sprintf(p, "%uL",
                  (data == 1 ? aurora_access_generation(conf->access_engine)
                             : aurora_waf_generation(conf->engine))) -
      p;
  v->data = p;
  v->valid = 1;
  v->no_cacheable = 1;
  v->not_found = 0;
  return NGX_OK;
}

/* Optional observability variables, not an all-workers activation
 * acknowledgement. */
ngx_int_t ngx_http_gateway_variables(ngx_conf_t *cf) {
  ngx_str_t name = ngx_string("gateway_waf_generation");
  ngx_http_variable_t *v =
      ngx_http_add_variable(cf, &name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_generation;

  ngx_str_t access_name = ngx_string("gateway_access_generation");
  v = ngx_http_add_variable(cf, &access_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_generation;
  v->data = 1;

  ngx_str_t up_name = ngx_string("gateway_upstream");
  v = ngx_http_add_variable(cf, &up_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_upstream;

  ngx_str_t rule_name = ngx_string("gateway_split_rule");
  v = ngx_http_add_variable(cf, &rule_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_split_rule;

  ngx_str_t canary_status_name = ngx_string("gateway_canary_status");
  v = ngx_http_add_variable(cf, &canary_status_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_canary_status;

  ngx_str_t deploy_slot_name = ngx_string("gateway_deploy_slot");
  v = ngx_http_add_variable(cf, &deploy_slot_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_deploy_slot;

  ngx_str_t mirror_up_name = ngx_string("gateway_mirror_upstream");
  v = ngx_http_add_variable(cf, &mirror_up_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_mirror_upstream;

  ngx_str_t mirror_status_name = ngx_string("gateway_mirror_status");
  v = ngx_http_add_variable(cf, &mirror_status_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_mirror_status;

  return NGX_OK;
}

/*
 * Thiết lập location content handler khi directive gateway_metrics /
 * aurora_waf_metrics xuất hiện.
 */
char *ngx_http_gateway_metrics_directive(ngx_conf_t *cf, ngx_command_t *cmd,
                                         void *conf) {
  ngx_http_core_loc_conf_t *clcf;
  (void)cmd;
  (void)conf;

  clcf = ngx_http_conf_get_module_loc_conf(cf, ngx_http_core_module);
  clcf->handler = ngx_http_gateway_metrics_handler;

  return NGX_CONF_OK;
}

/*
 * Xử lý HTTP GET /metrics: gọi FFI sinh dữ liệu Prometheus/OpenMetrics text và
 * trả về client.
 */
ngx_int_t ngx_http_gateway_metrics_handler(ngx_http_request_t *r) {
  ngx_int_t rc;
  ngx_buf_t *b;
  ngx_chain_t out;
  u_char *metrics_buf;
  size_t written = 0;

  /* Chỉ chấp nhận GET hoặc HEAD */
  if (!(r->method & (NGX_HTTP_GET | NGX_HTTP_HEAD))) {
    return NGX_HTTP_NOT_ALLOWED;
  }

  rc = ngx_http_discard_request_body(r);
  if (rc != NGX_OK) {
    return rc;
  }

  /* Cấp phát buffer 4096 bytes trong request pool */
  metrics_buf = ngx_pcalloc(r->pool, 4096);
  if (metrics_buf == NULL) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }

  if (aurora_waf_format_prometheus_metrics(NULL, metrics_buf, 4096, &written) !=
      0) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }

  r->headers_out.status = NGX_HTTP_OK;
  r->headers_out.content_length_n = written;
  ngx_str_set(&r->headers_out.content_type,
              "text/plain; version=0.0.4; charset=utf-8");

  if (r->method == NGX_HTTP_HEAD) {
    rc = ngx_http_send_header(r);
    if (rc == NGX_ERROR || rc > NGX_OK || r->header_only) {
      return rc;
    }
  }

  b = ngx_create_temp_buf(r->pool, written);
  if (b == NULL) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }

  ngx_memcpy(b->pos, metrics_buf, written);
  b->last = b->pos + written;
  b->last_buf = (r == r->main) ? 1 : 0;
  b->last_in_chain = 1;

  out.buf = b;
  out.next = NULL;

  rc = ngx_http_send_header(r);
  if (rc == NGX_ERROR || rc > NGX_OK || r->header_only) {
    return rc;
  }

  return ngx_http_output_filter(r, &out);
}
