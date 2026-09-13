#include "gateway.h"
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static void ngx_http_gateway_request_termination_cleanup(void *data) {
  aurora_request_termination_destroy((AuroraRequestTerminationEngine *)data);
}

char *ngx_http_gateway_merge_request_termination(
    ngx_conf_t *cf, ngx_http_gateway_conf_t *prev,
    ngx_http_gateway_conf_t *conf) {
  ngx_pool_cleanup_t *cleanup;
  struct stat st;
  int fd;
  ssize_t n;
  size_t used = 0;
  u_char *bytes;
  uint32_t status;

  ngx_conf_merge_str_value(conf->request_termination_policy,
                           prev->request_termination_policy, "");
  if (conf->request_termination_policy.len == 0) {
    return NGX_CONF_OK;
  }

  if (prev->request_termination_engine &&
      conf->request_termination_policy.data ==
          prev->request_termination_policy.data) {
    conf->request_termination_engine = prev->request_termination_engine;
    return NGX_CONF_OK;
  }

  if (ngx_conf_full_name(cf->cycle, &conf->request_termination_policy, 0) !=
      NGX_OK) {
    return NGX_CONF_ERROR;
  }

  fd = open((char *)conf->request_termination_policy.data,
            O_RDONLY | O_NONBLOCK);
  if (fd == -1) {
    ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno,
                       "cannot open Gateway request termination policy %V",
                       &conf->request_termination_policy);
    return NGX_CONF_ERROR;
  }

  if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 ||
      st.st_size > 131072) {
    close(fd);
    ngx_conf_log_error(
        NGX_LOG_EMERG, cf, 0,
        "Gateway request termination policy must be a regular file "
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

  status = aurora_request_termination_create(
      bytes, used,
      (AuroraRequestTerminationEngine **)&conf->request_termination_engine);
  if (status != 0) {
    ngx_conf_log_error(
        NGX_LOG_EMERG, cf, 0,
        "invalid Gateway request termination policy %V (status %ui)",
        &conf->request_termination_policy, (ngx_uint_t)status);
    return NGX_CONF_ERROR;
  }

  cleanup->handler = ngx_http_gateway_request_termination_cleanup;
  cleanup->data = conf->request_termination_engine;
  return NGX_CONF_OK;
}

ngx_int_t ngx_http_gateway_eval_request_termination(
    ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host) {
  if (!conf || !conf->request_termination_engine) {
    return NGX_DECLINED;
  }

  /* Trích xuất header đến mà không cấp phát bộ nhớ động (0.00 warm heap alloc) */
  AuroraIncomingHeader in_headers[64];
  size_t headers_count = 0;

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
    if (headers_count < 64) {
      in_headers[headers_count].name_ptr = header[i].key.data;
      in_headers[headers_count].name_len = header[i].key.len;
      in_headers[headers_count].value_ptr = header[i].value.data;
      in_headers[headers_count].value_len = header[i].value.len;
      headers_count++;
    }
  }

  AuroraTerminationDecision decision;
  ngx_memzero(&decision, sizeof(decision));

  uint32_t status = aurora_request_termination_evaluate(
      conf->request_termination_engine, host.data, host.len, r->uri.data,
      r->uri.len, r->method_name.data, r->method_name.len, in_headers,
      headers_count, &decision);

  /* Đánh dấu context để phục vụ telemetry variable $gateway_termination_status */
  ngx_http_gateway_ctx_t *ctx =
      ngx_http_get_module_ctx(r, ngx_http_gateway_module);
  if (ctx == NULL) {
    ctx = ngx_pcalloc(r->pool, sizeof(ngx_http_gateway_ctx_t));
    if (ctx != NULL) {
      ngx_http_set_ctx(r, ctx, ngx_http_gateway_module);
    }
  }
  if (ctx != NULL && status == 0 && decision.matched) {
    ctx->evaluated = 1;
    ctx->is_terminated = decision.should_terminate ? 1 : 0;
  }

  if (status != 0 || !decision.matched || !decision.should_terminate) {
    return NGX_DECLINED;
  }

  /* Thiết lập HTTP Status Code */
  r->headers_out.status = (decision.status_code >= 200 &&
                           decision.status_code <= 599)
                              ? (ngx_uint_t)decision.status_code
                              : NGX_HTTP_SERVICE_UNAVAILABLE;
  r->headers_out.content_length_n = decision.body_len;

  /* Thiết lập Content-Type mặc định nếu có */
  if (decision.content_type_len > 0) {
    r->headers_out.content_type.len = decision.content_type_len;
    r->headers_out.content_type.data = (u_char *)decision.content_type;
  } else if (decision.body_len > 0 && decision.body != NULL) {
    if (decision.body[0] == '{' || decision.body[0] == '[') {
      ngx_str_set(&r->headers_out.content_type,
                  "application/json; charset=utf-8");
    } else {
      ngx_str_set(&r->headers_out.content_type, "text/plain; charset=utf-8");
    }
  }

  /* Gắn các custom response headers */
  for (uint32_t j = 0; j < decision.headers_count; j++) {
    AuroraUpstreamHeader *dh = &decision.headers[j];
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
  }

  /* Discard any incoming request body for terminated requests */
  ngx_http_discard_request_body(r);

  /* HEAD Request: Chỉ gửi header và kết thúc */
  if (r->method == NGX_HTTP_HEAD) {
    ngx_int_t rc = ngx_http_send_header(r);
    ngx_http_finalize_request(r, rc);
    return NGX_DONE;
  }

  /* Gửi trực tiếp response body nếu có */
  if (decision.body_len > 0 && decision.body != NULL) {
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

  /* Trường hợp không có body: Gửi header và hoàn tất */
  ngx_int_t rc = ngx_http_send_header(r);
  ngx_http_finalize_request(r, rc);
  return NGX_DONE;
}

ngx_int_t ngx_http_gateway_variable_termination_status(
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
    (void)ngx_http_gateway_eval_request_termination(target_r, conf, host);
    ctx = ngx_http_get_module_ctx(target_r, ngx_http_gateway_module);
  }

  if (ctx != NULL && ctx->evaluated) {
    if (ctx->is_terminated) {
      v->len = sizeof("terminated") - 1;
      v->data = (u_char *)"terminated";
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
