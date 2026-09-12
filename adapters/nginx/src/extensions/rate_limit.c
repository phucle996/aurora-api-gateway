#include "gateway.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void ngx_http_gateway_rate_limit_cleanup(void *data) {
  aurora_rate_limit_destroy(data);
}

char *ngx_http_gateway_merge_rate_limit(ngx_conf_t *cf,
                                        ngx_http_gateway_conf_t *prev,
                                        ngx_http_gateway_conf_t *conf) {
  ngx_pool_cleanup_t *cleanup;
  struct stat st;
  int fd;
  ssize_t n;
  size_t used = 0;
  u_char *bytes;
  uint32_t status;

  ngx_conf_merge_str_value(conf->rate_limit_policy, prev->rate_limit_policy,
                           "");
  if (conf->rate_limit_policy.len == 0) {
    return NGX_CONF_OK;
  }
  if (((ngx_http_core_loc_conf_t *)ngx_http_conf_get_module_loc_conf(
           cf, ngx_http_core_module))
          ->satisfy == NGX_HTTP_SATISFY_ANY) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "Gateway rate limit requires satisfy all");
    return NGX_CONF_ERROR;
  }
  if (prev->rate_limit_engine &&
      conf->rate_limit_policy.data == prev->rate_limit_policy.data) {
    conf->rate_limit_engine = prev->rate_limit_engine;
    return NGX_CONF_OK;
  }
  if (ngx_conf_full_name(cf->cycle, &conf->rate_limit_policy, 0) != NGX_OK) {
    return NGX_CONF_ERROR;
  }

  fd = open((char *)conf->rate_limit_policy.data, O_RDONLY | O_NONBLOCK);
  if (fd == -1) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno,
                       "cannot open Gateway rate limit policy %V",
                       &conf->rate_limit_policy);
    return NGX_CONF_ERROR;
  }
  if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
      st.st_size > 131072) {
    close(fd);
    ngx_conf_log_error(
        NGX_LOG_EMERG, cf, 0,
        "Gateway rate limit policy must be a regular file of 1..131072 bytes");
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
  status = aurora_rate_limit_create(bytes, used, &conf->rate_limit_engine);
  if (status != 0) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, 0,
                       "invalid Gateway rate limit policy %V (status %ui)",
                       &conf->rate_limit_policy, (ngx_uint_t)status);
    return NGX_CONF_ERROR;
  }
  cleanup->handler = ngx_http_gateway_rate_limit_cleanup;
  cleanup->data = conf->rate_limit_engine;
  return NGX_CONF_OK;
}

ngx_int_t ngx_http_gateway_eval_rate_limit(ngx_http_request_t *r,
                                           ngx_http_gateway_conf_t *conf,
                                           ngx_str_t host) {
  if (!conf->rate_limit_engine) {
    return NGX_DECLINED;
  }

  ngx_str_t client_ip = r->connection->addr_text;
  if (client_ip.len == 0) {
    return NGX_HTTP_BAD_REQUEST;
  }
  AuroraRateLimitDecision decision;
  ngx_memzero(&decision, sizeof(decision));

  uint32_t status = aurora_rate_limit_evaluate(
      conf->rate_limit_engine, host.data, host.len, r->uri.data, r->uri.len,
      client_ip.data, client_ip.len, r, ngx_http_gateway_header_lookup,
      &decision);
  if (status == 1) {
    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_ERR, &log, 0,
                  "Gateway rate limit invalid request: %ui",
                  (ngx_uint_t)status);
    return NGX_HTTP_BAD_REQUEST;
  }
  if (status != 0) {
    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_ERR, &log, 0,
                  "Gateway rate limit internal failure: %ui",
                  (ngx_uint_t)status);
    return NGX_HTTP_INTERNAL_SERVER_ERROR;
  }

  if (decision.action == 3) {
    /* Audit mode: Warn and tag request without blocking */
    ngx_table_elt_t *h = ngx_list_push(&r->headers_out.headers);
    if (h) {
      h->hash = 1;
      ngx_str_set(&h->key, "X-RateLimit-Exceeded");
      ngx_str_set(&h->value, "1");
    }
    ngx_log_t log = *r->connection->log;
    log.handler = NULL;
    ngx_log_error(NGX_LOG_NOTICE, &log, 0,
                  "Gateway rate limit audit: would limit path %V", &r->uri);
  } else if (!decision.allowed) {
    ngx_uint_t h_idx;
    ngx_uint_t retry_after_set = 0;

    /* Append custom headers defined by client policy */
    for (h_idx = 0; h_idx < decision.headers_count &&
                    h_idx < AURORA_RATE_LIMIT_MAX_HEADERS;
         h_idx++) {
      AuroraRateLimitHeader *dh = &decision.headers[h_idx];
      if (dh->name_len == 0) {
        continue;
      }
      ngx_table_elt_t *h = ngx_list_push(&r->headers_out.headers);
      if (h == NULL) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }
      h->hash = 1;
      h->key.len = dh->name_len;
      h->key.data = ngx_pnalloc(r->pool, dh->name_len);
      if (h->key.data == NULL) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }
      ngx_memcpy(h->key.data, dh->name, dh->name_len);

      h->value.len = dh->value_len;
      h->value.data = ngx_pnalloc(r->pool, dh->value_len);
      if (h->value.data == NULL) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }
      ngx_memcpy(h->value.data, dh->value, dh->value_len);

      if (dh->name_len == 12 &&
          ngx_strncasecmp(dh->name, (u_char *)"content-type", 12) == 0) {
        r->headers_out.content_type.len = dh->value_len;
        r->headers_out.content_type.data = h->value.data;
      }
      if (dh->name_len == 11 &&
          ngx_strncasecmp(dh->name, (u_char *)"retry-after", 11) == 0) {
        retry_after_set = 1;
      }
    }

    /* Default Retry-After if not explicitly overridden in custom headers */
    if (!retry_after_set && decision.retry_after_secs > 0) {
      ngx_table_elt_t *retry_after = ngx_list_push(&r->headers_out.headers);
      if (retry_after) {
        retry_after->hash = 1;
        ngx_str_set(&retry_after->key, "Retry-After");
        u_char *buf = ngx_pcalloc(r->pool, 16);
        if (buf) {
          retry_after->value.len =
              ngx_snprintf(buf, 16, "%ud", decision.retry_after_secs) - buf;
          retry_after->value.data = buf;
        }
      }
    }

    /* If custom body is configured, emit response directly and terminate phase
     */
    if (decision.body_len > 0) {
      r->headers_out.status = (decision.status_code > 0)
                                  ? (ngx_uint_t)decision.status_code
                                  : NGX_HTTP_TOO_MANY_REQUESTS;
      r->headers_out.content_length_n = decision.body_len;

      if (r->headers_out.content_type.len == 0) {
        if (decision.body[0] == '{' || decision.body[0] == '[') {
          ngx_str_set(&r->headers_out.content_type,
                      "application/json; charset=utf-8");
        } else {
          ngx_str_set(&r->headers_out.content_type,
                      "text/plain; charset=utf-8");
        }
      }

      if (r->method == NGX_HTTP_HEAD) {
        ngx_int_t rc = ngx_http_send_header(r);
        ngx_http_finalize_request(r, rc);
        return NGX_DONE;
      }

      ngx_chain_t out;
      ngx_buf_t *b = ngx_create_temp_buf(r->pool, decision.body_len);
      if (b == NULL) {
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
      }

      ngx_memcpy(b->pos, decision.body, decision.body_len);
      b->last = b->pos + decision.body_len;
      b->last_buf = (r == r->main) ? 1 : 0;
      b->last_in_chain = 1;

      out.buf = b;
      out.next = NULL;

      ngx_int_t rc = ngx_http_send_header(r);
      if (rc == NGX_ERROR || rc > NGX_OK || r->header_only) {
        ngx_http_finalize_request(r, rc);
        return NGX_DONE;
      }

      rc = ngx_http_output_filter(r, &out);
      ngx_http_finalize_request(r, rc);
      return NGX_DONE;
    }

    return (decision.status_code > 0) ? (ngx_int_t)decision.status_code
                                      : NGX_HTTP_TOO_MANY_REQUESTS;
  }

  return NGX_DECLINED;
}
