#ifndef GATEWAY_H
#define GATEWAY_H

#include <ngx_config.h>
#include <ngx_core.h>
#include <ngx_http.h>
#include "ffi.h"

/*
 * Cấu hình Gateway cho từng location / server block trong NGINX.
 */
typedef struct {
    ngx_flag_t enabled;      /* Bật/tắt Gateway (on/off) */
    ngx_uint_t mode;         /* Chế độ WAF: enforce (chặn) hoặc audit (chỉ log) */
    ngx_str_t access_policy;
    AuroraAccessEngine *access_engine;
    ngx_str_t jwt_policy;
    AuroraJwtEngine *jwt_engine;
    ngx_str_t rate_limit_policy;
    AuroraRateLimitEngine *rate_limit_engine;
    ngx_str_t conn_limit_policy;
    AuroraConnectionLimitEngine *conn_limit_engine;
    ngx_str_t policy;        /* Đường dẫn tới file WAF policy snapshot */
    AuroraEngine *engine;    /* Con trỏ tới instance Rust WAF engine */
} ngx_http_gateway_conf_t;

extern ngx_module_t ngx_http_gateway_module;
extern ngx_shm_zone_t *gateway_telemetry_zone;


/* Pipeline Handler */
ngx_int_t ngx_http_gateway_handler(ngx_http_request_t *r);

/* Extension: Access Policy */
char *ngx_http_gateway_merge_access(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_access(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host);

/* Extension: JWT Authentication */
char *ngx_http_gateway_merge_jwt(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_jwt(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host);

/* Extension: Rate Limit */
char *ngx_http_gateway_merge_rate_limit(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_rate_limit(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host);

/* Extension: Connection Limit */
char *ngx_http_gateway_merge_conn_limit(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_conn_limit(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host);

/* Extension: Core WAF */
char *ngx_http_gateway_merge_waf(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev, ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_waf(ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host);

/* Telemetry, Variables, and Metrics Handler */
ngx_int_t ngx_http_gateway_telemetry_zone_init(ngx_shm_zone_t *zone, void *previous);
ngx_int_t ngx_http_gateway_variables(ngx_conf_t *cf);
char *ngx_http_gateway_metrics_directive(ngx_conf_t *cf, ngx_command_t *cmd, void *conf);
ngx_int_t ngx_http_gateway_metrics_handler(ngx_http_request_t *r);

#endif /* GATEWAY_H */
