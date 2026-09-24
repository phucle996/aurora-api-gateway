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
  (void)data;
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  u_char *p;

  if (!conf || !conf->ip_restriction_engine) {
    v->not_found = 1;
    return NGX_OK;
  }

  p = ngx_pnalloc(r->pool, NGX_INT64_LEN);
  if (p == NULL) {
    return NGX_ERROR;
  }
  v->len =
      ngx_sprintf(p, "%uL", aurora_ip_restriction_generation(conf->ip_restriction_engine)) - p;
  v->data = p;
  v->valid = 1;
  v->no_cacheable = 1;
  v->not_found = 0;
  return NGX_OK;
}

static ngx_int_t ngx_http_gateway_variable_log_active(
    ngx_http_request_t *r, ngx_http_variable_value_t *v, uintptr_t data) {
  (void)r;
  (void)data;
  if (aurora_gateway_is_log_active()) {
    v->len = 1;
    v->data = (u_char *)"1";
  } else {
    v->len = 1;
    v->data = (u_char *)"0";
  }
  v->valid = 1;
  v->no_cacheable = 1;
  v->not_found = 0;
  return NGX_OK;
}

/* Optional observability variables, not an all-workers activation
 * acknowledgement. */
ngx_int_t ngx_http_gateway_variables(ngx_conf_t *cf) {
  ngx_http_variable_t *v;

  ngx_str_t access_name = ngx_string("gateway_ip_restriction_generation");
  v = ngx_http_add_variable(cf, &access_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_generation;

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

  ngx_str_t termination_status_name = ngx_string("gateway_termination_status");
  v = ngx_http_add_variable(cf, &termination_status_name,
                            NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_termination_status;

  ngx_str_t log_active_name = ngx_string("gateway_log_active");
  v = ngx_http_add_variable(cf, &log_active_name, NGX_HTTP_VAR_NOCACHEABLE);
  if (v == NULL) {
    return NGX_ERROR;
  }
  v->get_handler = ngx_http_gateway_variable_log_active;

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

  const char *msg =
      "# Aurora Gateway metrics are exported via aurora-agent (port 9100)\n";
  written = ngx_strlen(msg);
  metrics_buf = ngx_pnalloc(r->pool, written + 1);
  if (metrics_buf == NULL) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }
  ngx_memcpy(metrics_buf, msg, written);

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

/*
 * Hook vào HTTP LOG Phase của NGINX: thực thi sau khi request đã hoàn tất và
 * client đã nhận phản hồi. Ghi nhận thời gian xử lý và mã trạng thái HTTP một
 * cách bất đồng bộ, không block client.
 */
ngx_int_t ngx_http_gateway_log_handler(ngx_http_request_t *r) {
  ngx_time_t *tp;
  ngx_msec_int_t ms;
  uint32_t status;
  ngx_http_gateway_conf_t *conf;
  ngx_http_gateway_ctx_t *ctx;

  if (r == NULL) {
    return NGX_OK;
  }

  conf = ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  if (conf == NULL || !conf->enabled) {
    return NGX_OK;
  }

  /* L4: Connection gauges (lockless store) */
  if (ngx_stat_active != NULL) {
    aurora_gateway_record_connections(
        (uint64_t)*ngx_stat_active,
        ngx_stat_reading ? (uint64_t)*ngx_stat_reading : 0,
        ngx_stat_writing ? (uint64_t)*ngx_stat_writing : 0,
        ngx_stat_waiting ? (uint64_t)*ngx_stat_waiting : 0);
  }

  /* L7: Request timing */
  tp = ngx_timeofday();
  ms = (ngx_msec_int_t)((tp->sec - r->start_sec) * 1000 +
                        (tp->msec - r->start_msec));
  if (ms < 0) {
    ms = 0;
  }

  status = (r->headers_out.status > 0) ? (uint32_t)r->headers_out.status
                                       : (uint32_t)r->err_status;
  if (status == 0) {
    status = 200;
  }

  aurora_gateway_record_request(status, (uint64_t)ms);

  /* L7: Traffic volume (bytes in/out, SSL flag, extension-matched flag) */
  {
    uint64_t bytes_in = (uint64_t)r->request_length;
    uint64_t bytes_out = (uint64_t)r->connection->sent;
    uint32_t is_ssl = 0;
    uint32_t is_matched = 0;

#if (NGX_SSL)
    if (r->connection->ssl) {
      is_ssl = 1;
    }
#endif

    ctx = ngx_http_get_module_ctx(r, ngx_http_gateway_module);
    if (ctx != NULL && ctx->evaluated) {
      is_matched = 1;
    }

    aurora_gateway_record_traffic(bytes_in, bytes_out, is_ssl, is_matched);
  }

#if (NGX_SSL)
  /* L4: SSL handshake recording (only for main requests, once per connection) */
  if (r == r->main && r->connection->ssl && r->connection->requests == 1) {
    /* SSL_session_reused returns 1 if session was reused from cache */
    uint32_t reused =
        (SSL_session_reused(r->connection->ssl->connection)) ? 1 : 0;
    aurora_gateway_record_ssl(1, reused);
  }
#endif

  /* Upstream: response status, latency, connect time, failures */
  if (r->upstream && r->upstream->state) {
    ngx_http_upstream_state_t *us = r->upstream->state;
    uint32_t up_status =
        (us->status > 0) ? (uint32_t)us->status : 0;
    uint64_t response_ms = 0;
    uint64_t connect_ms = 0;
    uint32_t failed = 0;

    if (us->response_time != (ngx_msec_t)-1) {
      response_ms = (uint64_t)us->response_time;
    }
    if (us->connect_time != (ngx_msec_t)-1) {
      connect_ms = (uint64_t)us->connect_time;
    }
    if (up_status == 0 || up_status >= 502) {
      failed = 1;
    }

    aurora_gateway_record_upstream(up_status, response_ms, connect_ms, failed);
  }

  return NGX_OK;
}
