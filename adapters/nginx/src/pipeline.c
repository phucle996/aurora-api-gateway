#include "gateway.h"

/*
 * Handler chính của Gateway xử lý request trong HTTP Access Phase.
 * Điều phối tuần tự qua các stage: Access Control -> Core WAF -> JWT Auth -> Rate Limiting.
 */
ngx_int_t
ngx_http_gateway_handler(ngx_http_request_t *r)
{
    ngx_http_gateway_conf_t *conf = ngx_http_get_module_loc_conf(r, ngx_http_gateway_module);
    ngx_str_t host;
    ngx_int_t rc;

    if (!conf || !conf->enabled) {
        return NGX_DECLINED;
    }

    host = r->headers_in.server;
    if (host.len == 0) {
        ngx_http_core_srv_conf_t *server = ngx_http_get_module_srv_conf(r, ngx_http_core_module);
        host = server->server_name;
    }

    /* Stage 1: Access Control (IP Whitelist/Blacklist/CIDR) */
    rc = ngx_http_gateway_eval_access(r, conf, host);
    if (rc != NGX_DECLINED) {
        return rc;
    }

    /* Stage 2: Core WAF (Path inspection / attack rules) */
    rc = ngx_http_gateway_eval_waf(r, conf, host);
    if (rc != NGX_DECLINED) {
        return rc;
    }

    /* Stage 3: In-process JWT Authentication */
    rc = ngx_http_gateway_eval_jwt(r, conf, host);
    if (rc != NGX_DECLINED) {
        return rc;
    }

    /* Stage 4: In-process Rate Limiting */
    rc = ngx_http_gateway_eval_rate_limit(r, conf, host);
    if (rc != NGX_DECLINED) {
        return rc;
    }

    /* Stage 5: In-process Connection Limiting */
    rc = ngx_http_gateway_eval_conn_limit(r, conf, host);
    if (rc != NGX_DECLINED) {
        return rc;
    }

    /* Stage 6: In-process Traffic Shaper */
    rc = ngx_http_gateway_eval_traffic_shaper(r, conf, host);
    if (rc != NGX_DECLINED) {
        return rc;
    }

    /* Stage 7: In-process Request Size Limit */
    rc = ngx_http_gateway_eval_request_size_limit(r, conf, host);
    if (rc != NGX_DECLINED) {
        return rc;
    }

    /* All checks passed: Cho phép request đi tiếp */
    return NGX_DECLINED;
}
