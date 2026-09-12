#include "gateway.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

typedef struct {
    AuroraConnectionLimitEngine *engine;
    AuroraConnLimitToken token;
} ngx_http_gateway_conn_limit_ctx_t;

static void
ngx_http_gateway_conn_limit_req_cleanup(void *data)
{
    ngx_http_gateway_conn_limit_ctx_t *ctx = data;
    if (ctx && ctx->engine) {
        aurora_conn_limit_release(ctx->engine, &ctx->token);
    }
}

static void
ngx_http_gateway_conn_limit_cleanup(void *data)
{
    aurora_conn_limit_destroy(data);
}

char *
ngx_http_gateway_merge_conn_limit(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf)
{
    ngx_pool_cleanup_t *cleanup;
    struct stat st;
    int fd;
    ssize_t n;
    size_t used = 0;
    u_char *bytes;
    uint32_t status;

    ngx_conf_merge_str_value(conf->conn_limit_policy, prev->conn_limit_policy, "");
    if (conf->conn_limit_policy.len == 0) { return NGX_CONF_OK; }
    if (((ngx_http_core_loc_conf_t *) ngx_http_conf_get_module_loc_conf(cf, ngx_http_core_module))->satisfy == NGX_HTTP_SATISFY_ANY) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway connection limit requires satisfy all");
        return NGX_CONF_ERROR;
    }
    if (prev->conn_limit_engine && conf->conn_limit_policy.data == prev->conn_limit_policy.data) {
        conf->conn_limit_engine = prev->conn_limit_engine;
        return NGX_CONF_OK;
    }
    if (ngx_conf_full_name(cf->cycle, &conf->conn_limit_policy, 0) != NGX_OK) { return NGX_CONF_ERROR; }

    fd = open((char *) conf->conn_limit_policy.data, O_RDONLY|O_NONBLOCK);
    if (fd == -1) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno, "cannot open Gateway connection limit policy %V", &conf->conn_limit_policy);
        return NGX_CONF_ERROR;
    }
    if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 131072) {
        close(fd);
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway connection limit policy must be a regular file of 1..131072 bytes");
        return NGX_CONF_ERROR;
    }
    bytes = ngx_pnalloc(cf->temp_pool, 131073);
    if (bytes == NULL) { close(fd); return NGX_CONF_ERROR; }
    while (used < 131073) {
        n = read(fd, bytes + used, 131073 - used);
        if (n == -1 && errno == EINTR) { continue; }
        if (n <= 0) { break; }
        used += (size_t) n;
    }
    close(fd);
    if (n < 0 || used != (size_t) st.st_size) { return NGX_CONF_ERROR; }

    cleanup = ngx_pool_cleanup_add(cf->pool, 0);
    if (cleanup == NULL) { return NGX_CONF_ERROR; }
    status = aurora_conn_limit_create(bytes, used, &conf->conn_limit_engine);
    if (status != 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "invalid Gateway connection limit policy %V (status %ui)", &conf->conn_limit_policy, (ngx_uint_t) status);
        return NGX_CONF_ERROR;
    }
    cleanup->handler = ngx_http_gateway_conn_limit_cleanup;
    cleanup->data = conf->conn_limit_engine;
    return NGX_CONF_OK;
}

uint32_t
ngx_http_gateway_header_lookup(void *ctx,
    const uint8_t *name, size_t name_len,
    const uint8_t **out_val, size_t *out_val_len)
{
    ngx_http_request_t *r = (ngx_http_request_t *) ctx;
    if (r == NULL || name == NULL || name_len == 0 || out_val == NULL || out_val_len == NULL) {
        return 1;
    }

    /* Fast path for common single-header pointers if matched */
    if (name_len == 13 && ngx_strncasecmp((u_char *) name, (u_char *) "authorization", 13) == 0) {
        if (r->headers_in.authorization && r->headers_in.authorization->value.len > 0) {
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
            if (part->next == NULL) { break; }
            part = part->next;
            header = part->elts;
            i = 0;
        }
        if (header[i].key.len == name_len &&
            ngx_strncasecmp(header[i].key.data, (u_char *) name, name_len) == 0)
        {
            *out_val = header[i].value.data;
            *out_val_len = header[i].value.len;
            return 0;
        }
    }

    return 1;
}

ngx_int_t
ngx_http_gateway_eval_conn_limit(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host)
{
    if (!conf->conn_limit_engine) {
        return NGX_DECLINED;
    }

    ngx_str_t client_ip = r->connection->addr_text;
    if (client_ip.len == 0) {
        return NGX_HTTP_BAD_REQUEST;
    }

    AuroraConnLimitDecision decision;
    ngx_memzero(&decision, sizeof(decision));

    uint32_t status = aurora_conn_limit_acquire(conf->conn_limit_engine,
                                               host.data, host.len,
                                               r->uri.data, r->uri.len,
                                               client_ip.data, client_ip.len,
                                               r,
                                               ngx_http_gateway_header_lookup,
                                               &decision);
    if (status == 1) {
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Gateway connection limit invalid request: %ui", (ngx_uint_t) status);
        return NGX_HTTP_BAD_REQUEST;
    }
    if (status != 0) {
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Gateway connection limit internal failure: %ui", (ngx_uint_t) status);
        return NGX_HTTP_INTERNAL_SERVER_ERROR;
    }

    if (decision.action == 3) {
        /* Audit mode */
        ngx_table_elt_t *h = ngx_list_push(&r->headers_out.headers);
        if (h) {
            h->hash = 1;
            ngx_str_set(&h->key, "X-ConnLimit-Exceeded");
            ngx_str_set(&h->value, "1");
        }
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_NOTICE, &log, 0, "Gateway connection limit audit: would limit path %V", &r->uri);
    } else if (!decision.allowed) {
        ngx_uint_t h_idx;

        /* Append custom headers defined by client policy */
        for (h_idx = 0; h_idx < decision.headers_count && h_idx < AURORA_CONN_LIMIT_MAX_HEADERS; h_idx++) {
            AuroraConnLimitHeader *dh = &decision.headers[h_idx];
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

            if (dh->name_len == 12 && ngx_strncasecmp(dh->name, (u_char *) "content-type", 12) == 0) {
                r->headers_out.content_type.len = dh->value_len;
                r->headers_out.content_type.data = h->value.data;
            }
        }

        /* If custom body is configured, emit response directly and terminate phase */
        if (decision.body_len > 0) {
            r->headers_out.status = (decision.status_code > 0) ? (ngx_uint_t) decision.status_code : NGX_HTTP_SERVICE_UNAVAILABLE;
            r->headers_out.content_length_n = decision.body_len;

            if (r->headers_out.content_type.len == 0) {
                if (decision.body[0] == '{' || decision.body[0] == '[') {
                    ngx_str_set(&r->headers_out.content_type, "application/json; charset=utf-8");
                } else {
                    ngx_str_set(&r->headers_out.content_type, "text/plain; charset=utf-8");
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

        return (decision.status_code > 0) ? (ngx_int_t) decision.status_code : NGX_HTTP_SERVICE_UNAVAILABLE;
    } else if (decision.has_token) {
        /* Allowed: Attach cleanup to request pool to guarantee slot release on finish or disconnect */
        ngx_pool_cleanup_t *cln = ngx_pool_cleanup_add(r->pool, sizeof(ngx_http_gateway_conn_limit_ctx_t));
        if (cln == NULL) {
            aurora_conn_limit_release(conf->conn_limit_engine, &decision.token);
            return NGX_HTTP_INTERNAL_SERVER_ERROR;
        }
        ngx_http_gateway_conn_limit_ctx_t *ctx = cln->data;
        ctx->engine = conf->conn_limit_engine;
        ctx->token = decision.token;
        cln->handler = ngx_http_gateway_conn_limit_req_cleanup;
    }

    return NGX_DECLINED;
}
