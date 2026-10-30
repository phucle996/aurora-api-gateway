#include "gateway.h"

#if defined(__linux__)
#include <netinet/tcp.h>
#include <sys/socket.h>

#ifndef TCP_NOTSENT_LOWAT
#define TCP_NOTSENT_LOWAT 25
#endif
#endif

/*
 * Hardened Kernel Socket Acceleration (RFC & CVE Compliant).
 * Defensively applies only safe, non-interfering kernel socket options:
 * - TCP_NOTSENT_LOWAT (32KB): Mitigates kernel send bufferbloat and HTTP/2 HOL blocking
 *   without causing epoll busy-spin loops on legacy Linux kernels.
 *
 * Deliberately pruned to eliminate CVE vulnerabilities & RFC protocol violations:
 * - TCP_NODELAY: Left to NGINX native state machine (`tcp_nodelay on; tcp_nopush on;`)
 *   to avoid breaking sendfile() MTU frame corking (RFC 896 / RFC 1122).
 * - SO_BUSY_POLL: Omitted to prevent CPU core starvation & soft-lockups under high concurrency.
 * - TCP_USER_TIMEOUT: Omitted to prevent premature connection kills on lossy / 4G networks (RFC 5482).
 * - TCP_CONGESTION (BBR): Delegated to OS sysctl rather than per-socket churn (mitigates SACK panic CVE-2019-11477).
 */
static inline void ngx_http_gateway_accelerate_socket(ngx_connection_t *c) {
#if defined(__linux__) && defined(TCP_NOTSENT_LOWAT)
  if (c == NULL || c->fd == (ngx_socket_t)-1) {
    return;
  }

  /* Conservative 32KB bufferbloat clamp */
  unsigned int notsent_lowat = 32768;
  (void)setsockopt(c->fd, IPPROTO_TCP, TCP_NOTSENT_LOWAT, (const void *)&notsent_lowat, sizeof(notsent_lowat));
#else
  (void)c;
#endif
}

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

static uint8_t *ngx_http_gateway_alloc(void *ctx, size_t size) {
  ngx_http_request_t *r = (ngx_http_request_t *)ctx;
  if (__builtin_expect(r == NULL || r->pool == NULL, 0)) {
    return NULL;
  }
  return (uint8_t *)ngx_pnalloc(r->pool, size);
}

/*
 * Thi hành quyết định Từ chối (DENY) từ Gateway Access Phase.
 * Khử hoàn toàn rẽ nhánh theo từng mã HTTP; trực tiếp trả về status code hoặc custom body.
 * Zero-copy: Content-Type và Body đã được Rust ghi trực tiếp vào request pool memory.
 */
static ngx_int_t ngx_http_gateway_execute_deny(ngx_http_request_t *r,
                                               const AuroraAccessOutcome *out) {
  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);

  if (out->flags & AURORA_FLAG_WWW_AUTH) {
    ngx_table_elt_t *challenge = ngx_list_push(&r->headers_out.headers);
    if (challenge != NULL) {
      challenge->hash = 1;
      ngx_str_set(&challenge->key, "WWW-Authenticate");
      ngx_str_set(&challenge->value, "Bearer");
    }
  }

  /* Release token or cache pinned Arc cleanup hook */
  if (out->flags & AURORA_FLAG_CACHE_PINNED) {
    if (ctx != NULL) {
      ctx->from_cache = 1;
    }
    ngx_pool_cleanup_t *cln = ngx_pool_cleanup_add(r->pool, 0);
    if (cln != NULL) {
      cln->handler = (ngx_pool_cleanup_pt)aurora_release_cache_entry;
      uintptr_t ptr_val = 0;
      ngx_memcpy(&ptr_val, &out->release_token.opaque[0], sizeof(uintptr_t));
      cln->data = (void *)ptr_val;
    }
  }

  /* Response headers (X-Cache, Content-Encoding, Vary, Age, etc.) */
  uint32_t count = out->headers_count < AURORA_MAX_FORWARD_HEADERS
                       ? out->headers_count
                       : AURORA_MAX_FORWARD_HEADERS;
  for (uint32_t i = 0; i < count; i++) {
    if (out->headers[i].name_len == 0 || out->headers[i].name == NULL) {
      continue;
    }
    ngx_table_elt_t *h = ngx_list_push(&r->headers_out.headers);
    if (h != NULL) {
      h->hash = 1;
      h->key.len = out->headers[i].name_len;
      h->key.data = (u_char *)out->headers[i].name;
      h->value.len = out->headers[i].value_len;
      h->value.data = (u_char *)out->headers[i].value;
    }
  }

  if (out->body_len == 0 || out->body == NULL) {
    return (ngx_int_t)out->status_code;
  }

  r->headers_out.status = (out->status_code >= 200 && out->status_code <= 599)
                              ? (ngx_uint_t)out->status_code
                              : NGX_HTTP_SERVICE_UNAVAILABLE;
  r->headers_out.content_length_n = out->body_len;

  if (out->content_type_len > 0 && out->content_type != NULL) {
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

  ngx_buf_t *b = ngx_pcalloc(r->pool, sizeof(ngx_buf_t));
  if (__builtin_expect(b == NULL, 0)) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }
  b->pos = (u_char *)out->body;
  b->last = (u_char *)out->body + out->body_len;
  b->memory = 1;
  b->last_buf = (r == r->main) ? 1 : 0;
  b->last_in_chain = 1;

  ngx_chain_t out_chain = {.buf = b, .next = NULL};

  ngx_int_t rc = ngx_http_send_header(r);
  if (rc == NGX_ERROR || rc > NGX_OK || r->header_only) {
    ngx_http_finalize_request(r, rc);
    return NGX_DONE;
  }
  rc = ngx_http_output_filter(r, &out_chain);
  ngx_http_finalize_request(r, rc);
  return NGX_DONE;
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
    if (__builtin_expect(ctx == NULL, 0)) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_http_set_ctx(r, ctx, ngx_http_gateway_module);
  }
  ctx->evaluated = 1;

  /* 1. Forwarded headers injection: ghi đè lên header cùng tên nếu đã có, hoặc chèn mới */
  uint32_t count = out->headers_count < AURORA_MAX_FORWARD_HEADERS
                       ? out->headers_count
                       : AURORA_MAX_FORWARD_HEADERS;
  for (uint32_t i = 0; i < count; i++) {
    if (out->headers[i].name_len == 0 || out->headers[i].name == NULL) {
      continue;
    }

    size_t klen = out->headers[i].name_len;
    size_t vlen = out->headers[i].value_len;
    const u_char *kname = out->headers[i].name;
    const u_char *kval = out->headers[i].value;
    const u_char *klow = out->headers[i].lowcase_name;

    ngx_table_elt_t *h = NULL;

    /* Tìm kiếm header đã tồn tại trong r->headers_in.headers để ghi đè */
    ngx_list_part_t *part = &r->headers_in.headers.part;
    ngx_table_elt_t *header = part->elts;
    u_char k0 = kname[0];
    while (part != NULL) {
      for (ngx_uint_t j = 0; j < part->nelts; j++) {
        if (header[j].hash != 0 && header[j].key.len == klen) {
          /* Kiểm tra nhanh ký tự đầu (không phân biệt hoa thường) trước khi gọi ngx_strncasecmp */
          u_char c0 = header[j].key.data[0];
          if ((c0 == k0 || (c0 ^ k0) == 0x20)
              && ngx_strncasecmp(header[j].key.data, (u_char *)kname, klen) == 0) {
            h = &header[j];
            break;
          }
        }
      }
      if (h != NULL) {
        break;
      }
      part = part->next;
      if (part != NULL) {
        header = part->elts;
      }
    }

    if (h != NULL) {
      /* Ghi đè giá trị lên header đã tồn tại: Zero-copy trỏ thẳng vào memory pool */
      h->value.len = vlen;
      h->value.data = (u_char *)kval;
    } else {
      /* Header chưa có thì chèn mới vào list: Zero-copy trỏ thẳng vào memory pool */
      h = ngx_list_push(&r->headers_in.headers);
      if (__builtin_expect(h == NULL, 0)) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }
      ngx_memzero(h, sizeof(ngx_table_elt_t));
      h->hash = 1;

      h->key.len = klen;
      h->key.data = (u_char *)kname;

      h->value.len = vlen;
      h->value.data = (u_char *)kval;

      h->lowcase_key = (u_char *)klow;
    }
  }

  /* 2. Target upstream routing: Zero-copy trỏ thẳng vào memory pool */
  if (out->target_upstream_len > 0 && out->target_upstream != NULL) {
    ctx->target_upstream.data = (u_char *)out->target_upstream;
    ctx->target_upstream.len = out->target_upstream_len;
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

  /* Hot-path kernel socket acceleration: applied once per accepted TCP connection */
  if (r->connection != NULL && r->connection->requests <= 1) {
    ngx_http_gateway_accelerate_socket(r->connection);
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx != NULL && ctx->evaluated) {
    return NGX_DECLINED;
  }

  if (ctx == NULL) {
    ctx = ngx_pcalloc(r->pool, sizeof(ngx_http_gateway_ctx_t));
    if (__builtin_expect(ctx == NULL, 0)) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_http_set_ctx(r, ctx, ngx_http_gateway_module);
  }
  ctx->evaluated = 1;
  ctx->route_mask = 0xFFFFFFFFU;

  if (r->unparsed_uri.len > 0 && r->unparsed_uri.data != NULL &&
      r->unparsed_uri.data[0] == '/') {
    size_t plen = 0;
    while (plen < r->unparsed_uri.len && r->unparsed_uri.data[plen] != '?') {
      plen++;
    }
    ctx->orig_path.data = r->unparsed_uri.data;
    ctx->orig_path.len = plen;
  } else {
    ctx->orig_path = r->uri;
  }

  if (!ctx->in_flight_entered) {
    aurora_gateway_in_flight_enter();
    ctx->in_flight_entered = 1;
  }

  ngx_str_t host = r->headers_in.server;
  if (host.len == 0) {
    ngx_http_core_srv_conf_t *server =
        ngx_http_get_module_srv_conf(r, ngx_http_core_module);
    host = server->server_name;
  }

  ngx_time_t *tp = ngx_timeofday();
  size_t header_len = (r->header_in) ? (size_t)(r->header_in->pos - r->header_in->start) : 0;
  AuroraAccessInput input = {
      .client_ip = r->connection->addr_text.data,
      .client_ip_len = r->connection->addr_text.len,
      .host = host.data,
      .host_len = host.len,
      .path = ctx->orig_path.data,
      .path_len = ctx->orig_path.len,
      .method = r->method_name.data,
      .method_len = r->method_name.len,
      .query = r->args.data,
      .query_len = r->args.len,
      .content_length = (r->headers_in.content_length_n > 0)
                            ? (uint64_t)r->headers_in.content_length_n
                            : 0,
      .header_length = (uint64_t)header_len,
      .random_seed = (uint32_t)ngx_random(),
      .now_ms = (uint64_t)tp->sec * 1000 + tp->msec,
  };

  AuroraAccessOutcome outcome;

  if (aurora_gateway_phase_access(&input, r, ngx_http_gateway_header_lookup,
                                  ngx_http_gateway_alloc, &outcome) != 0) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }

  ctx->route_mask = outcome.route_mask;

  if (outcome.action == AURORA_ACTION_DENY) {
    return ngx_http_gateway_execute_deny(r, &outcome);
  }

  return ngx_http_gateway_execute_allow(r, &outcome);
}

/* ========================================================================== */
/* Egress Output Filters (Header Filter & Zero-Copy SIMD Body Filter)         */
/* ========================================================================== */

ngx_int_t ngx_http_gateway_header_filter(ngx_http_request_t *r) {
  ngx_http_gateway_conf_t *conf =
      ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
  if (conf == NULL || !conf->enabled) {
    return ngx_http_next_header_filter(r);
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx == NULL || ctx->from_cache) {
    return ngx_http_next_header_filter(r);
  }

  if (r->headers_out.content_length_n > 0) {
    ctx->orig_content_length = (size_t)r->headers_out.content_length_n;
  }

  /* C-level route_mask short-circuit: skip FFI if route disables compression */
  if (!(ctx->route_mask & (1U << AURORA_EXT_RESPONSE_COMPRESSION))) {
    return ngx_http_next_header_filter(r);
  }

  const uint8_t *ae_val = NULL;
  size_t ae_len = 0;
  if (r->headers_in.accept_encoding != NULL) {
    ae_val = (const uint8_t *)r->headers_in.accept_encoding->value.data;
    ae_len = r->headers_in.accept_encoding->value.len;
  }

  AuroraHeaderFilterInput input = {
      .upstream_status = (uint32_t)r->headers_out.status,
      .is_websocket = 0,
      .path = (ctx->orig_path.len > 0) ? ctx->orig_path.data : r->uri.data,
      .path_len = (ctx->orig_path.len > 0) ? ctx->orig_path.len : r->uri.len,
      .content_type = r->headers_out.content_type.data,
      .content_type_len = r->headers_out.content_type.len,
      .content_length = (r->headers_out.content_length_n > 0)
                            ? (size_t)r->headers_out.content_length_n
                            : 0,
      .accept_encoding = ae_val,
      .accept_encoding_len = ae_len,
  };

  AuroraHeaderFilterOutcome outcome;
  if (aurora_gateway_phase_header_filter(&input, &outcome) == 0) {
    if (outcome.action == AURORA_FILTER_COMPRESS &&
        outcome.compression_algorithm > 0) {
      ctx->compression_algorithm = outcome.compression_algorithm;

      /* Gắn header Content-Encoding: zstd / br / gzip */
      if (outcome.content_encoding_len > 0 &&
          outcome.content_encoding_str != NULL) {
        ngx_table_elt_t *ce = ngx_list_push(&r->headers_out.headers);
        if (ce != NULL) {
          ce->hash = 1;
          ngx_str_set(&ce->key, "Content-Encoding");
          ce->value.len = outcome.content_encoding_len;
          ce->value.data = (u_char *)outcome.content_encoding_str;
        }
      }

      /* Gắn header Vary: Accept-Encoding để phòng ngừa cache poisoning */
      ngx_table_elt_t *vary = ngx_list_push(&r->headers_out.headers);
      if (vary != NULL) {
        vary->hash = 1;
        ngx_str_set(&vary->key, "Vary");
        ngx_str_set(&vary->value, "Accept-Encoding");
      }

      /* Xoá Content-Length vì kích thước payload sau nén sẽ thay đổi */
      r->headers_out.content_length_n = -1;
      if (r->headers_out.content_length != NULL) {
        r->headers_out.content_length->hash = 0;
        r->headers_out.content_length = NULL;
      }
    }
  }

  return ngx_http_next_header_filter(r);
}

ngx_int_t ngx_http_gateway_body_filter(ngx_http_request_t *r, ngx_chain_t *in) {
  if (in == NULL || r->header_only) {
    return ngx_http_next_body_filter(r, in);
  }

  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx != NULL && ctx->from_cache) {
    return ngx_http_next_body_filter(r, in);
  }

  size_t in_len = (in->buf != NULL) ? (size_t)(in->buf->last - in->buf->pos) : 0;
  int is_complete_body =
      (in_len > 0 && in->next == NULL && (r == r->main) &&
       (in->buf->last_buf || in->buf->last_in_chain ||
        (ctx != NULL && ctx->orig_content_length > 0 &&
         in_len >= ctx->orig_content_length) ||
        (r->headers_out.content_length_n > 0 &&
         in_len >= (size_t)r->headers_out.content_length_n)));

  /* Single-shot response caching fast-path (C-level route_mask short-circuit) */
  if (is_complete_body && r->headers_out.status >= 200 &&
      r->headers_out.status <= 404 &&
      (ctx == NULL || (ctx->route_mask & (1U << AURORA_EXT_RESPONSE_CACHE)))) {
    const u_char *cc_val = NULL;
    size_t cc_len = 0;
    const u_char *etag_val = NULL;
    size_t etag_len = 0;

    ngx_list_part_t *part = &r->headers_out.headers.part;
    ngx_table_elt_t *header = part->elts;
    while (part != NULL) {
      for (ngx_uint_t i = 0; i < part->nelts; i++) {
        if (header[i].hash != 0) {
          if (header[i].key.len == 13 &&
              ngx_strncasecmp(header[i].key.data, (u_char *)"cache-control", 13) == 0) {
            cc_val = header[i].value.data;
            cc_len = header[i].value.len;
          } else if (header[i].key.len == 4 &&
                     ngx_strncasecmp(header[i].key.data, (u_char *)"etag", 4) == 0) {
            etag_val = header[i].value.data;
            etag_len = header[i].value.len;
          }
        }
      }
      part = part->next;
      if (part != NULL) {
        header = part->elts;
      }
    }

    AuroraCacheStoreInput cache_in = {
        .method = r->method_name.data,
        .method_len = r->method_name.len,
        .host = (r->headers_in.server.len > 0) ? r->headers_in.server.data : (u_char *)"localhost",
        .host_len = (r->headers_in.server.len > 0) ? r->headers_in.server.len : 9,
        .path = (ctx != NULL && ctx->orig_path.len > 0) ? ctx->orig_path.data : r->uri.data,
        .path_len = (ctx != NULL && ctx->orig_path.len > 0) ? ctx->orig_path.len : r->uri.len,
        .query = r->args.data,
        .query_len = r->args.len,
        .status = (uint32_t)r->headers_out.status,
        .content_type = r->headers_out.content_type.data,
        .content_type_len = r->headers_out.content_type.len,
        .body = in->buf->pos,
        .body_len = in_len,
        .cache_control = cc_val,
        .cache_control_len = cc_len,
        .etag = etag_val,
        .etag_len = etag_len,
    };
    aurora_gateway_phase_cache_store(&cache_in);
  }

  if (ctx == NULL || ctx->compression_algorithm == 0) {
    return ngx_http_next_body_filter(r, in);
  }

  /* Single-shot response compression */
  if (is_complete_body) {
    AuroraBodyFilterInput input = {
        .chunk = in->buf->pos,
        .chunk_len = in_len,
        .is_last = 1,
        .compression_algorithm = ctx->compression_algorithm,
        .alloc_ctx = (void *)r,
        .alloc_fn = ngx_http_gateway_alloc,
    };

      AuroraBodyFilterOutcome outcome;
      if (aurora_gateway_phase_body_filter(&input, &outcome) == 0) {
        if (outcome.action == AURORA_BODY_FILTER_MUTATED &&
            outcome.out_ptr != NULL && outcome.out_len > 0) {
          /* Zero-copy: Chuyển giao trực tiếp con trỏ bộ nhớ từ pool */
          in->buf->pos = (u_char *)outcome.out_ptr;
          in->buf->last = (u_char *)outcome.out_ptr + outcome.out_len;
        }
      }
    }
    /* Đã nén xong 1-shot, reset cờ */
    ctx->compression_algorithm = 0;

  return ngx_http_next_body_filter(r, in);
}
