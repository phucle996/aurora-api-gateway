#include "gateway.h"

void ngx_http_gateway_conn_token_req_cleanup(void *data) {
  ngx_http_gateway_conn_token_ctx_t *ctx = data;
  if (ctx != NULL) {
    aurora_gateway_connection_release(&ctx->token);
  }
}

uint32_t ngx_http_gateway_header_lookup(void *ctx, const uint8_t *name,
                                        size_t name_len,
                                        const uint8_t **out_val,
                                        size_t *out_val_len) {
  ngx_http_request_t *r = (ngx_http_request_t *)ctx;
  if (!r || !name || name_len == 0 || !out_val || !out_val_len) {
    return 1;
  }

  if (name_len == 13 &&
      ngx_strncasecmp((u_char *)name, (u_char *)"authorization", 13) == 0) {
    if (r->headers_in.authorization &&
        r->headers_in.authorization->value.len > 0) {
      *out_val = r->headers_in.authorization->value.data;
      *out_val_len = r->headers_in.authorization->value.len;
      return 0;
    }
  }

  ngx_list_part_t *part = &r->headers_in.headers.part;
  ngx_table_elt_t *header = part->elts;
  ngx_uint_t i;

  for (i = 0; /* void */; i++) {
    if (i >= part->nelts) {
      if (part->next == NULL) {
        break;
      }
      part = part->next;
      header = part->elts;
      i = 0;
    }
    if (header[i].key.len == name_len &&
        ngx_strncasecmp(header[i].key.data, (u_char *)name, name_len) == 0) {
      *out_val = header[i].value.data;
      *out_val_len = header[i].value.len;
      return 0;
    }
  }

  return 1;
}

/*
 * Thi hành quyết định Từ chối (DENY) từ Gateway Access Phase.
 * Khử hoàn toàn rẽ nhánh theo từng mã HTTP; trực tiếp trả về status code hoặc custom body.
 */
static ngx_int_t ngx_http_gateway_execute_deny(ngx_http_request_t *r,
                                               const AuroraAccessOutcome *out) {
  if (out->flags & AURORA_FLAG_WWW_AUTH) {
    ngx_table_elt_t *challenge = ngx_list_push(&r->headers_out.headers);
    if (challenge != NULL) {
      challenge->hash = 1;
      ngx_str_set(&challenge->key, "WWW-Authenticate");
      ngx_str_set(&challenge->value, "Bearer");
    }
  }

  if (out->body_len == 0) {
    return (ngx_int_t)out->status_code;
  }

  r->headers_out.status = (out->status_code >= 200 && out->status_code <= 599)
                              ? (ngx_uint_t)out->status_code
                              : NGX_HTTP_SERVICE_UNAVAILABLE;
  r->headers_out.content_length_n = out->body_len;

  if (out->content_type_len > 0) {
    r->headers_out.content_type.len = out->content_type_len;
    r->headers_out.content_type.data = (u_char *)out->content_type;
  } else {
    ngx_str_set(&r->headers_out.content_type, "text/plain; charset=utf-8");
  }

  ngx_http_discard_request_body(r);

  if (r->method == NGX_HTTP_HEAD) {
    ngx_int_t rc = ngx_http_send_header(r);
    ngx_http_finalize_request(r, rc);
    return NGX_DONE;
  }

  ngx_buf_t *b = ngx_create_temp_buf(r->pool, out->body_len);
  if (b == NULL) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }
  ngx_memcpy(b->pos, out->body, out->body_len);
  b->last = b->pos + out->body_len;
  b->last_buf = (r == r->main) ? 1 : 0;
  b->last_in_chain = 1;

  ngx_chain_t out_chain = {.buf = b, .next = NULL};

  ngx_int_t rc = ngx_http_send_header(r);
  if (rc == NGX_ERROR || rc > NGX_OK || r->header_only) {
    return rc;
  }
  return ngx_http_output_filter(r, &out_chain);
}

/*
 * Thi hành quyết định Cho phép (ALLOW) từ Gateway Access Phase.
 * Áp dụng forwarded headers, target upstream routing, token cleanup hook, và bandwidth limit.
 */
static ngx_int_t ngx_http_gateway_execute_allow(
    ngx_http_request_t *r, const AuroraAccessOutcome *out) {
  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx == NULL) {
    ctx = ngx_pcalloc(r->pool, sizeof(ngx_http_gateway_ctx_t));
    if (ctx == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_http_set_ctx(r, ctx, ngx_http_gateway_module);
  }
  ctx->evaluated = 1;

  /* 1. Forwarded headers injection */
  uint32_t count = out->headers_count < AURORA_MAX_FORWARD_HEADERS
                       ? out->headers_count
                       : AURORA_MAX_FORWARD_HEADERS;
  for (uint32_t i = 0; i < count; i++) {
    if (out->headers[i].name_len == 0) {
      continue;
    }
    ngx_table_elt_t *h = ngx_list_push(&r->headers_in.headers);
    if (h == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_memzero(h, sizeof(ngx_table_elt_t));
    h->hash = 1;

    h->key.len = out->headers[i].name_len;
    h->key.data = ngx_pnalloc(r->pool, h->key.len);
    if (h->key.data == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_memcpy(h->key.data, out->headers[i].name, h->key.len);

    h->value.len = out->headers[i].value_len;
    h->value.data = ngx_pnalloc(r->pool, h->value.len);
    if (h->value.data == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_memcpy(h->value.data, out->headers[i].value, h->value.len);

    h->lowcase_key = ngx_pnalloc(r->pool, h->key.len);
    if (h->lowcase_key == NULL) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_strlow(h->lowcase_key, h->key.data, h->key.len);
  }

  /* 2. Target upstream routing */
  if (out->target_upstream_len > 0) {
    u_char *up = ngx_pnalloc(r->pool, out->target_upstream_len);
    if (up != NULL) {
      ngx_memcpy(up, out->target_upstream, out->target_upstream_len);
      ctx->target_upstream.data = up;
      ctx->target_upstream.len = out->target_upstream_len;
    }
  }

  /* 3. In-flight token release hook */
  if (out->flags & AURORA_FLAG_HAS_RELEASE_TOKEN) {
    ngx_http_gateway_conn_token_ctx_t *tok_ctx =
        ngx_palloc(r->pool, sizeof(ngx_http_gateway_conn_token_ctx_t));
    if (tok_ctx != NULL) {
      tok_ctx->token = out->release_token;
      ngx_pool_cleanup_t *cleanup = ngx_pool_cleanup_add(r->pool, 0);
      if (cleanup != NULL) {
        cleanup->handler = ngx_http_gateway_conn_token_req_cleanup;
        cleanup->data = tok_ctx;
      }
    }
  }

  /* 4. Bandwidth rate limit */
  if (out->rate_limit_bytes_per_sec > 0) {
    r->limit_rate = (size_t)out->rate_limit_bytes_per_sec;
  }

  return NGX_DECLINED;
}

/*
 * Handler chính của Gateway xử lý request trong HTTP Access Phase.
 * Thuần túy là cầu nối Phase: Nạp ngữ cảnh request, gọi FFI nhận Outcome và thi hành.
 */
ngx_int_t ngx_http_gateway_handler(ngx_http_request_t *r) {
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  if (!conf || !conf->enabled) {
    return NGX_DECLINED;
  }

  ngx_str_t host = r->headers_in.server;
  if (host.len == 0) {
    ngx_http_core_srv_conf_t *server =
        ngx_http_get_module_srv_conf(r, ngx_http_core_module);
    host = server->server_name;
  }

  ngx_time_t *tp = ngx_timeofday();
  AuroraAccessInput input = {
      .client_ip = r->connection->addr_text.data,
      .client_ip_len = r->connection->addr_text.len,
      .host = host.data,
      .host_len = host.len,
      .path = r->uri.data,
      .path_len = r->uri.len,
      .method = r->method_name.data,
      .method_len = r->method_name.len,
      .query = r->args.data,
      .query_len = r->args.len,
      .content_length = (r->headers_in.content_length_n > 0)
                            ? (uint64_t)r->headers_in.content_length_n
                            : 0,
      .random_seed = (uint32_t)ngx_random(),
      .now_ms = (uint64_t)tp->sec * 1000 + tp->msec,
  };

  aurora_gateway_in_flight_enter();

  AuroraAccessOutcome outcome;
  ngx_memzero(&outcome, sizeof(outcome));

  if (aurora_gateway_phase_access(&input, r, ngx_http_gateway_header_lookup,
                                  &outcome) != 0) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }

  if (outcome.action == AURORA_ACTION_DENY) {
    return ngx_http_gateway_execute_deny(r, &outcome);
  }

  return ngx_http_gateway_execute_allow(r, &outcome);
}
