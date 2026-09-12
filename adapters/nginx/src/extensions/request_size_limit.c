#include "gateway.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

static void
ngx_http_gateway_request_size_limit_cleanup(void *data)
{
    aurora_request_size_limit_destroy(data);
}

char *
ngx_http_gateway_merge_request_size_limit(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf)
{
    ngx_pool_cleanup_t *cleanup;
    struct stat st;
    int fd;
    ssize_t n;
    size_t used = 0;
    u_char *bytes;
    uint32_t status;

    ngx_conf_merge_str_value(conf->request_size_limit_policy, prev->request_size_limit_policy, "");
    if (conf->request_size_limit_policy.len == 0) { return NGX_CONF_OK; }

    if (prev->request_size_limit_engine && conf->request_size_limit_policy.data == prev->request_size_limit_policy.data) {
        conf->request_size_limit_engine = prev->request_size_limit_engine;
        return NGX_CONF_OK;
    }
    if (ngx_conf_full_name(cf->cycle, &conf->request_size_limit_policy, 0) != NGX_OK) { return NGX_CONF_ERROR; }

    fd = open((char *) conf->request_size_limit_policy.data, O_RDONLY|O_NONBLOCK);
    if (fd == -1) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno, "cannot open Gateway request size limit policy %V", &conf->request_size_limit_policy);
        return NGX_CONF_ERROR;
    }
    if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 131072) {
        close(fd);
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway request size limit policy must be a regular file of 1..131072 bytes");
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
    status = aurora_request_size_limit_create(bytes, used, (AuroraRequestSizeLimitEngine **) &conf->request_size_limit_engine);
    if (status != 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "invalid Gateway request size limit policy %V (status %ui)", &conf->request_size_limit_policy, (ngx_uint_t) status);
        return NGX_CONF_ERROR;
    }
    cleanup->handler = ngx_http_gateway_request_size_limit_cleanup;
    cleanup->data = conf->request_size_limit_engine;
    return NGX_CONF_OK;
}

ngx_int_t
ngx_http_gateway_eval_request_size_limit(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host)
{
    if (!conf->request_size_limit_engine) {
        return NGX_DECLINED;
    }

    ngx_str_t client_ip = r->connection->addr_text;
    if (client_ip.len == 0) {
        return NGX_DECLINED;
    }

    uint64_t header_bytes = (uint64_t)(r->request_length > 0 ? r->request_length : 0);
    uint64_t body_bytes = (uint64_t)(r->headers_in.content_length_n > 0 ? r->headers_in.content_length_n : 0);

    AuroraRequestSizeDecision decision;
    ngx_memzero(&decision, sizeof(decision));

    uint32_t status = aurora_request_size_limit_evaluate(
        conf->request_size_limit_engine,
        host.data, host.len,
        r->uri.data, r->uri.len,
        client_ip.data, client_ip.len,
        header_bytes,
        body_bytes,
        r,
        ngx_http_gateway_header_lookup,
        &decision
    );

    if (status != 0) {
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Gateway request size limit eval failure: %ui", (ngx_uint_t) status);
        return NGX_DECLINED;
    }

    if (decision.matched && !decision.allowed) {
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_WARN, &log, 0,
                      "Gateway request size limit exceeded: rule %*s, status %ud, headers %uL, body %uL",
                      (int) decision.rule_id_len, decision.rule_id,
                      (ngx_uint_t) decision.status_code,
                      header_bytes, body_bytes);

        /* Prevent keep-alive socket reuse for oversized/rejected requests to avoid pipeline poisoning */
        r->keepalive = 0;
        ngx_http_discard_request_body(r);

        if (decision.body_len > 0) {
            r->headers_out.status = (decision.status_code > 0) ? (ngx_uint_t) decision.status_code : NGX_HTTP_REQUEST_ENTITY_TOO_LARGE;
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
            b->last_buf = 1;
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

        return (decision.status_code > 0) ? (ngx_int_t) decision.status_code : NGX_HTTP_REQUEST_ENTITY_TOO_LARGE;
    }

    return NGX_DECLINED;
}
