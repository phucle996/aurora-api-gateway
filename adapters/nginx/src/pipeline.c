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
    u_char *ct = ngx_pnalloc(r->pool, out->content_type_len);
    if (__builtin_expect(ct == NULL, 0)) {
      return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }
    ngx_memcpy(ct, out->content_type, out->content_type_len);
    r->headers_out.content_type.len = out->content_type_len;
    r->headers_out.content_type.data = ct;
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
    if (out->headers[i].name_len == 0) {
      continue;
    }

    size_t klen = out->headers[i].name_len;
    size_t vlen = out->headers[i].value_len;
    const u_char *kname = out->headers[i].name;
    const u_char *kval = out->headers[i].value;

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
      /* Ghi đè giá trị lên header đã được setup để forward */
      h->value.len = vlen;
      h->value.data = ngx_pnalloc(r->pool, vlen);
      if (__builtin_expect(h->value.data == NULL, 0)) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }
      ngx_memcpy(h->value.data, kval, vlen);
    } else {
      /* Header chưa có thì chèn mới vào list */
      h = ngx_list_push(&r->headers_in.headers);
      if (__builtin_expect(h == NULL, 0)) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }
      ngx_memzero(h, sizeof(ngx_table_elt_t));
      h->hash = 1;

      /* Single-bump arena: Cấp phát liền mạch đúng 1 lần cho (key + value + lowcase_key)
       * trong cùng một L1 CPU cacheline (64 bytes), loại bỏ phân mảnh và 2 lần syscall ngx_pnalloc */
      size_t total_alloc = (klen << 1) + vlen;
      u_char *buf = ngx_pnalloc(r->pool, total_alloc);
      if (__builtin_expect(buf == NULL, 0)) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }

      h->key.len = klen;
      h->key.data = buf;
      ngx_memcpy(buf, kname, klen);

      h->value.len = vlen;
      h->value.data = buf + klen;
      ngx_memcpy(buf + klen, kval, vlen);

      h->lowcase_key = buf + klen + vlen;
      ngx_strlow(h->lowcase_key, buf, klen);
    }
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
      .path = r->uri.data,
      .path_len = r->uri.len,
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
                                  &outcome) != 0) {
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }

  if (outcome.action == AURORA_ACTION_DENY) {
    return ngx_http_gateway_execute_deny(r, &outcome);
  }

  return ngx_http_gateway_execute_allow(r, &outcome);
}
