#include "gateway.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

static void
ngx_http_gateway_rate_limit_cleanup(void *data)
{
    aurora_rate_limit_destroy(data);
}

char *
ngx_http_gateway_merge_rate_limit(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf)
{
    ngx_pool_cleanup_t *cleanup;
    struct stat st;
    int fd;
    ssize_t n;
    size_t used = 0;
    u_char *bytes;
    uint32_t status;

    ngx_conf_merge_str_value(conf->rate_limit_policy, prev->rate_limit_policy, "");
    if (conf->rate_limit_policy.len == 0) { return NGX_CONF_OK; }
    if (((ngx_http_core_loc_conf_t *) ngx_http_conf_get_module_loc_conf(cf, ngx_http_core_module))->satisfy == NGX_HTTP_SATISFY_ANY) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway rate limit requires satisfy all");
        return NGX_CONF_ERROR;
    }
    if (prev->rate_limit_engine && conf->rate_limit_policy.data == prev->rate_limit_policy.data) {
        conf->rate_limit_engine = prev->rate_limit_engine;
        return NGX_CONF_OK;
    }
    if (ngx_conf_full_name(cf->cycle, &conf->rate_limit_policy, 0) != NGX_OK) { return NGX_CONF_ERROR; }

    fd = open((char *) conf->rate_limit_policy.data, O_RDONLY|O_NONBLOCK);
    if (fd == -1) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno, "cannot open Gateway rate limit policy %V", &conf->rate_limit_policy);
        return NGX_CONF_ERROR;
    }
    if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 131072) {
        close(fd);
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway rate limit policy must be a regular file of 1..131072 bytes");
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
    status = aurora_rate_limit_create(bytes, used, &conf->rate_limit_engine);
    if (status != 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "invalid Gateway rate limit policy %V (status %ui)", &conf->rate_limit_policy, (ngx_uint_t) status);
        return NGX_CONF_ERROR;
    }
    cleanup->handler = ngx_http_gateway_rate_limit_cleanup;
    cleanup->data = conf->rate_limit_engine;
    return NGX_CONF_OK;
}

ngx_int_t
ngx_http_gateway_eval_rate_limit(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host)
{
    if (!conf->rate_limit_engine) {
        return NGX_DECLINED;
    }

    ngx_str_t client_ip = r->connection->addr_text;
    if (client_ip.len == 0) {
        return NGX_HTTP_BAD_REQUEST;
    }
    ngx_table_elt_t *authorization = r->headers_in.authorization;
    const u_char *auth_data = authorization ? authorization->value.data : NULL;
    size_t auth_len = authorization ? authorization->value.len : 0;

    /* Extract X-API-Key if present */
    const u_char *api_key_data = NULL;
    size_t api_key_len = 0;
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
        if (header[i].key.len == 9 && ngx_strncasecmp(header[i].key.data, (u_char *) "x-api-key", 9) == 0) {
            api_key_data = header[i].value.data;
            api_key_len = header[i].value.len;
            break;
        }
    }

    AuroraRateLimitDecision decision;
    ngx_memzero(&decision, sizeof(decision));

    uint32_t status = aurora_rate_limit_evaluate(conf->rate_limit_engine,
                                                host.data, host.len,
                                                r->uri.data, r->uri.len,
                                                client_ip.data, client_ip.len,
                                                api_key_data, api_key_len,
                                                auth_data, auth_len,
                                                &decision);
    if (status == 1) {
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Gateway rate limit invalid request: %ui", (ngx_uint_t) status);
        return NGX_HTTP_BAD_REQUEST;
    }
    if (status != 0) {
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Gateway rate limit internal failure: %ui", (ngx_uint_t) status);
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
        ngx_log_error(NGX_LOG_NOTICE, &log, 0, "Gateway rate limit audit: would limit path %V", &r->uri);
    } else if (!decision.allowed) {
        /* Add Retry-After header */
        ngx_table_elt_t *retry_after = ngx_list_push(&r->headers_out.headers);
        if (retry_after) {
            retry_after->hash = 1;
            ngx_str_set(&retry_after->key, "Retry-After");
            u_char *buf = ngx_pcalloc(r->pool, 16);
            if (buf) {
                retry_after->value.len = ngx_snprintf(buf, 16, "%ud", decision.retry_after_secs) - buf;
                retry_after->value.data = buf;
            }
        }
        return (decision.status_code > 0) ? (ngx_int_t) decision.status_code : NGX_HTTP_TOO_MANY_REQUESTS;
    }

    return NGX_DECLINED;
}
