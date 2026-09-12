#include "gateway.h"
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>

static void
ngx_http_gateway_jwt_cleanup(void *data)
{
    aurora_jwt_destroy(data);
}

/* JWT snapshot loader is intentionally independent from WAF and CIDR engines.
 * A configured JWT rule must use satisfy all so no other access module can
 * bypass its cryptographic decision. */
char *
ngx_http_gateway_merge_jwt(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf)
{
    ngx_pool_cleanup_t *cleanup;
    struct stat st;
    int fd;
    ssize_t n;
    size_t used = 0;
    u_char *bytes;
    uint32_t status;

    ngx_conf_merge_str_value(conf->jwt_policy, prev->jwt_policy, "");
    if (conf->jwt_policy.len == 0) { return NGX_CONF_OK; }
    if (((ngx_http_core_loc_conf_t *) ngx_http_conf_get_module_loc_conf(cf, ngx_http_core_module))->satisfy == NGX_HTTP_SATISFY_ANY) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway JWT requires satisfy all");
        return NGX_CONF_ERROR;
    }
    if (prev->jwt_engine && conf->jwt_policy.data == prev->jwt_policy.data) {
        conf->jwt_engine = prev->jwt_engine;
        return NGX_CONF_OK;
    }
    if (ngx_conf_full_name(cf->cycle, &conf->jwt_policy, 0) != NGX_OK) { return NGX_CONF_ERROR; }

    fd = open((char *) conf->jwt_policy.data, O_RDONLY|O_NONBLOCK);
    if (fd == -1) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, ngx_errno, "cannot open Gateway JWT policy %V", &conf->jwt_policy);
        return NGX_CONF_ERROR;
    }
    if (fstat(fd, &st) == -1 || !S_ISREG(st.st_mode) || st.st_size <= 0 || st.st_size > 65536) {
        close(fd);
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "Gateway JWT policy must be a regular file of 1..65536 bytes");
        return NGX_CONF_ERROR;
    }
    bytes = ngx_pnalloc(cf->temp_pool, 65537);
    if (bytes == NULL) { close(fd); return NGX_CONF_ERROR; }
    while (used < 65537) {
        n = read(fd, bytes + used, 65537 - used);
        if (n == -1 && errno == EINTR) { continue; }
        if (n <= 0) { break; }
        used += (size_t) n;
    }
    close(fd);
    if (n < 0 || used != (size_t) st.st_size) { return NGX_CONF_ERROR; }

    cleanup = ngx_pool_cleanup_add(cf->pool, 0);
    if (cleanup == NULL) { return NGX_CONF_ERROR; }
    status = aurora_jwt_create(bytes, used, &conf->jwt_engine);
    if (status != 0) {
        ngx_conf_log_error(NGX_LOG_EMERG, cf, 0, "invalid Gateway JWT policy %V (status %ui)", &conf->jwt_policy, (ngx_uint_t) status);
        return NGX_CONF_ERROR;
    }
    cleanup->handler = ngx_http_gateway_jwt_cleanup;
    cleanup->data = conf->jwt_engine;
    return NGX_CONF_OK;
}

ngx_int_t
ngx_http_gateway_eval_jwt(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host)
{
    if (!conf->jwt_engine) {
        return NGX_DECLINED;
    }

    ngx_table_elt_t *authorization = r->headers_in.authorization;
    const u_char *authorization_data = authorization ? authorization->value.data : NULL;
    size_t authorization_len = authorization ? authorization->value.len : 0;
    uint32_t status = aurora_jwt_evaluate(conf->jwt_engine, host.data, host.len,
                                         r->uri.data, r->uri.len,
                                         authorization_data, authorization_len);
    if (status == 1) {
        ngx_table_elt_t *challenge = ngx_list_push(&r->headers_out.headers);
        if (challenge == NULL) { return NGX_HTTP_INTERNAL_SERVER_ERROR; }
        challenge->hash = 1;
        ngx_str_set(&challenge->key, "WWW-Authenticate");
        ngx_str_set(&challenge->value, "Bearer");
        return NGX_HTTP_UNAUTHORIZED;
    }
    if (status != 0) {
        ngx_log_t log = *r->connection->log;
        log.handler = NULL;
        ngx_log_error(NGX_LOG_ERR, &log, 0, "Gateway JWT evaluation failed: %ui", (ngx_uint_t) status);
        return NGX_HTTP_SERVICE_UNAVAILABLE;
    }

    return NGX_DECLINED;
}
