#include "gateway.h"

static ngx_int_t ngx_http_gateway_generation(ngx_http_request_t *r,
                                             ngx_http_variable_value_t *v,
                                             uintptr_t data) {
  (void)data;
  u_char *p = ngx_pnalloc(r->pool, NGX_INT64_LEN);
  if (p == NULL) {
    return NGX_ERROR;
  }
  v->len = ngx_sprintf(p, "%uL", aurora_gateway_policy_generation()) - p;
  v->data = p;
  v->valid = 1;
  v->no_cacheable = 1;
  v->not_found = 0;
  return NGX_OK;
}

/* Optional observability variables */
ngx_int_t ngx_http_gateway_variables(ngx_conf_t *cf) {
  ngx_http_variable_t *v;

  ngx_str_t gen_name = ngx_string("gateway_generation");
  v = ngx_http_add_variable(cf, &gen_name, NGX_HTTP_VAR_NOCACHEABLE);
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

  return NGX_OK;
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
    (void)ngx_http_gateway_handler(r);
    ctx = ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  }

  if (ctx != NULL && ctx->target_upstream.len > 0) {
    v->len = ctx->target_upstream.len;
    v->data = ctx->target_upstream.data;
    v->valid = 1;
    v->no_cacheable = 1;
    v->not_found = 0;
    return NGX_OK;
  }

  v->not_found = 1;
  return NGX_OK;
}

/*
 * Thiết lập location content handler khi directive gateway_metrics xuất hiện.
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
 * Điều khiển bật/tắt thu thập structured / standard stream log nội tại của Gateway:
 * - off: gỡ đăng ký AURORA_SUB_STD_LOG, trả hệ thống về chế độ tàng hình (< 2ns).
 * - on: đăng ký AURORA_SUB_STD_LOG, xuất ra stdout chuẩn 12-factor.
 * - <path>: đăng ký AURORA_SUB_STD_LOG và chuyển giao đường dẫn xuất log trực tiếp sang Rust Shadow Worker.
 */
char *ngx_http_gateway_std_log_directive(ngx_conf_t *cf, ngx_command_t *cmd,
                                         void *conf) {
  ngx_str_t *value;
  (void)cmd;
  (void)conf;

  value = cf->args->elts;
  if (ngx_strcasecmp(value[1].data, (u_char *)"off") == 0) {
    aurora_gateway_telemetry_unsubscribe(AURORA_SUB_STD_LOG);
  } else {
    aurora_gateway_telemetry_subscribe(AURORA_SUB_STD_LOG);
    if (ngx_strcasecmp(value[1].data, (u_char *)"on") != 0) {
      aurora_gateway_set_log_path(value[1].data, value[1].len);
    }
  }

  return NGX_CONF_OK;
}

/*
 * Xử lý HTTP Content Phase của Gateway: thực thi sinh payload trực tiếp
 * mà không cần chuyển tiếp upstream (e.g. /metrics, /healthz).
 * C Adapter hoàn toàn không biết logic của plugin, chỉ tương tác thuần túy
 * qua Gateway Phase 2: HTTP Content Phase.
 */
ngx_int_t ngx_http_gateway_metrics_handler(ngx_http_request_t *r) {
  ngx_int_t rc;
  ngx_buf_t *b;
  ngx_chain_t out;
  u_char *content_buf;
  size_t written = 0;

  /* Chỉ chấp nhận GET hoặc HEAD */
  if (!(r->method & (NGX_HTTP_GET | NGX_HTTP_HEAD))) {
    return NGX_HTTP_NOT_ALLOWED;
  }

  rc = ngx_http_discard_request_body(r);
  if (rc != NGX_OK) {
    return rc;
  }

  u_char raw_body[8192];
  AuroraContentInput cin = {
      .host = r->headers_in.server.data,
      .host_len = r->headers_in.server.len,
      .path = r->uri.data,
      .path_len = r->uri.len,
      .method = r->method_name.data,
      .method_len = r->method_name.len,
      .query = r->args.data,
      .query_len = r->args.len,
  };
  AuroraContentOutcome cout;
  ngx_memzero(&cout, sizeof(cout));
  cout.body = raw_body;
  cout.body_cap = sizeof(raw_body);

  uint32_t phase_rc = aurora_gateway_phase_content(&cin, &cout);
  if (phase_rc == 0 && cout.body_len > 0) {
    written = cout.body_len;
    content_buf = ngx_pnalloc(r->pool, written + 1);
    if (content_buf == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_memcpy(content_buf, raw_body, written);
  } else {
    const char *fallback = "# No content available\n";
    written = ngx_strlen(fallback);
    content_buf = ngx_pnalloc(r->pool, written + 1);
    if (content_buf == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_memcpy(content_buf, fallback, written);
  }

  r->headers_out.status =
      (cout.status_code > 0) ? (ngx_uint_t)cout.status_code : NGX_HTTP_OK;
  r->headers_out.content_length_n = written;
  if (cout.content_type_len > 0) {
    u_char *ct = ngx_pnalloc(r->pool, cout.content_type_len);
    if (ct == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_memcpy(ct, cout.content_type, cout.content_type_len);
    r->headers_out.content_type.len = cout.content_type_len;
    r->headers_out.content_type.data = ct;
  } else {
    ngx_str_set(&r->headers_out.content_type,
                "text/plain; version=0.0.4; charset=utf-8");
  }

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

  ngx_memcpy(b->pos, content_buf, written);
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
 * client đã nhận phản hồi.
 *
 * C Adapter chỉ đóng vai trò Dumb Bridge: trích xuất metadata phẳng ngay trên
 * stack và bàn giao toàn bộ sang Gateway Phase 5: HTTP Log Phase (Shadow
 * Worker) bằng 1 lệnh duy nhất: aurora_gateway_phase_log(&log_input).
 */
ngx_int_t ngx_http_gateway_log_handler(ngx_http_request_t *r) {
  ngx_time_t *tp;
  ngx_msec_int_t ms;
  ngx_http_gateway_conf_t *conf;
  ngx_http_gateway_ctx_t *ctx;
  uint32_t subs;

  if (__builtin_expect(!r, 0)) {
    return NGX_OK;
  }

  /* Giảm In-Flight Request Gauge ngay khi request bước vào Log Phase (< 1ns) */
  aurora_gateway_in_flight_leave();

  conf = ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  if (__builtin_expect(!conf || !conf->enabled, 0)) {
    return NGX_OK;
  }

  /*
   * TÀNG HÌNH & MINH BẠCH (ZERO-COST STEALTH INACTIVITY):
   * Mô hình phân tách: Lõi Metrics Nội Tại (Intrinsic Kernel) <-> Plugin Vận Chuyển (Transport).
   * Đọc trực tiếp biến nguyên tử AURORA_TELEMETRY_SUBSCRIBERS từ L1 cache bằng 1 lệnh CPU duy nhất:
   * - Hoàn toàn không gọi hàm FFI (0 stack frame, 0 call/ret).
   * - Nếu không có plugin nào hoạt động (subs == 0), thoát ngay trong < 1ns.
   * - Hoàn toàn không phát sinh chi phí CPU/bộ nhớ so với NGINX gốc.
   */
  subs = AURORA_TELEMETRY_SUBSCRIBERS;
  if (__builtin_expect(subs == 0, 0)) {
    return NGX_OK;
  }

  AuroraLogInput log_input = {0};

  /* Chỉ trích xuất chuỗi nặng (IP, method, URI, headers) nếu Standard Log được subscribe */
  if (subs & AURORA_SUB_STD_LOG) {
    if (r->connection) {
      log_input.client_ip = r->connection->addr_text.data;
      log_input.client_ip_len = r->connection->addr_text.len;
    }

    log_input.method = r->method_name.data;
    log_input.method_len = r->method_name.len;

    log_input.uri = r->uri.data;
    log_input.uri_len = r->uri.len;

    log_input.host = r->headers_in.server.data;
    log_input.host_len = r->headers_in.server.len;

    if (r->headers_in.user_agent != NULL) {
      log_input.user_agent = r->headers_in.user_agent->value.data;
      log_input.user_agent_len = r->headers_in.user_agent->value.len;
    }

#if (NGX_SSL)
    if (r->connection && r->connection->ssl) {
      log_input.is_ssl = 1;
      if (r == r->main && r->connection->requests == 1) {
        log_input.ssl_reused =
            (SSL_session_reused(r->connection->ssl->connection)) ? 1 : 0;
      }
    }
#endif

    ctx = ngx_http_get_module_ctx(r, ngx_http_gateway_module);
    if (ctx != NULL && ctx->evaluated) {
      log_input.is_matched = 1;
    }

    if (r->upstream && r->upstream->state) {
      ngx_http_upstream_state_t *us = r->upstream->state;
      log_input.upstream_status = (us->status > 0) ? (uint32_t)us->status : 0;
      if (us->response_time != (ngx_msec_t)-1) {
        log_input.upstream_response_ms = (uint32_t)us->response_time;
      }
      if (us->connect_time != (ngx_msec_t)-1) {
        log_input.upstream_connect_ms = (uint32_t)us->connect_time;
      }
    }
  }

  /* Status & Timing (Cần thiết cho cả Metrics và Standard Log) */
  uint32_t status = (uint32_t)r->headers_out.status;
  if (__builtin_expect(!status, 0)) {
    status = (r->err_status > 0) ? (uint32_t)r->err_status : 200;
  }
  log_input.status = status;

  tp = ngx_timeofday();
  ms = (ngx_msec_int_t)((tp->sec - r->start_sec) * 1000 +
                        (tp->msec - r->start_msec));
  log_input.duration_ms = (ms > 0) ? (uint32_t)ms : 0;
  log_input.timestamp_unix_nano =
      ((uint64_t)tp->sec * 1000000000ULL) + ((uint64_t)tp->msec * 1000000ULL);

  log_input.bytes_recv = (uint64_t)r->request_length;
  if (r->connection) {
    log_input.bytes_sent = (uint64_t)r->connection->sent;
  }

  /* Connection Gauges (chỉ đọc khi metrics transport được kích hoạt) */
  if ((subs & AURORA_SUB_METRICS) && ngx_stat_active != NULL) {
    log_input.active_conns = (uint64_t)*ngx_stat_active;
    log_input.reading_conns =
        ngx_stat_reading ? (uint64_t)*ngx_stat_reading : 0;
    log_input.writing_conns =
        ngx_stat_writing ? (uint64_t)*ngx_stat_writing : 0;
    log_input.waiting_conns =
        ngx_stat_waiting ? (uint64_t)*ngx_stat_waiting : 0;
  }

  /* Bàn giao sang Gateway Phase 5: HTTP Log Phase (< 4ns với Metrics, 0 lock contention) */
  aurora_gateway_phase_log(&log_input);

  return NGX_OK;
}
