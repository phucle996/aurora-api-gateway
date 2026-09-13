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
  ngx_flag_t enabled; /* Bật/tắt Gateway (on/off) */
  ngx_uint_t mode;    /* Chế độ WAF: enforce (chặn) hoặc audit (chỉ log) */
  ngx_str_t access_policy;
  AuroraAccessEngine *access_engine;
  ngx_str_t jwt_policy;
  AuroraJwtEngine *jwt_engine;
  ngx_str_t rate_limit_policy;
  AuroraRateLimitEngine *rate_limit_engine;
  ngx_str_t conn_limit_policy;
  AuroraConnectionLimitEngine *conn_limit_engine;
  ngx_str_t traffic_shaper_policy;
  AuroraTrafficShaperEngine *traffic_shaper_engine;
  ngx_str_t request_size_limit_policy;
  AuroraRequestSizeLimitEngine *request_size_limit_engine;
  ngx_str_t traffic_split_policy;
  AuroraTrafficSplitEngine *traffic_split_engine;
  ngx_str_t canary_release_policy;
  AuroraCanaryReleaseEngine *canary_release_engine;
  ngx_str_t blue_green_policy;
  AuroraBlueGreenEngine *blue_green_engine;
  ngx_str_t request_mirror_policy;
  AuroraRequestMirrorEngine *request_mirror_engine;
  ngx_str_t policy;     /* Đường dẫn tới file WAF policy snapshot */
  AuroraEngine *engine; /* Con trỏ tới instance Rust WAF engine */
} ngx_http_gateway_conf_t;

typedef struct {
  ngx_str_t chosen_upstream;
  ngx_str_t mirror_upstream;
  ngx_str_t rule_id;
  ngx_str_t deploy_slot;
  ngx_uint_t evaluated;
  ngx_uint_t is_canary;
  ngx_uint_t is_header_override;
  ngx_uint_t is_mirrored;
} ngx_http_gateway_ctx_t;

extern ngx_module_t ngx_http_gateway_module;
extern ngx_shm_zone_t *gateway_telemetry_zone;

/* Pipeline Handler */
ngx_int_t ngx_http_gateway_handler(ngx_http_request_t *r);

/* Extension: Access Policy */
char *ngx_http_gateway_merge_access(ngx_conf_t *cf,
                                    ngx_http_gateway_conf_t *prev,
                                    ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_access(ngx_http_request_t *r,
                                       ngx_http_gateway_conf_t *conf,
                                       ngx_str_t host);

/* Extension: JWT Authentication */
char *ngx_http_gateway_merge_jwt(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev,
                                 ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_jwt(ngx_http_request_t *r,
                                    ngx_http_gateway_conf_t *conf,
                                    ngx_str_t host);

/* Shared: header lookup callback for extensions */
uint32_t ngx_http_gateway_header_lookup(void *ctx, const uint8_t *name,
                                        size_t name_len,
                                        const uint8_t **out_val,
                                        size_t *out_val_len);

/* Extension: Rate Limit */
char *ngx_http_gateway_merge_rate_limit(ngx_conf_t *cf,
                                        ngx_http_gateway_conf_t *prev,
                                        ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_rate_limit(ngx_http_request_t *r,
                                           ngx_http_gateway_conf_t *conf,
                                           ngx_str_t host);

/* Extension: Connection Limit */
char *ngx_http_gateway_merge_conn_limit(ngx_conf_t *cf,
                                        ngx_http_gateway_conf_t *prev,
                                        ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_conn_limit(ngx_http_request_t *r,
                                           ngx_http_gateway_conf_t *conf,
                                           ngx_str_t host);

/* Extension: Traffic Shaper */
char *ngx_http_gateway_merge_traffic_shaper(ngx_conf_t *cf,
                                            ngx_http_gateway_conf_t *prev,
                                            ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_traffic_shaper(ngx_http_request_t *r,
                                               ngx_http_gateway_conf_t *conf,
                                               ngx_str_t host);

/* Extension: Request Size Limit */
char *ngx_http_gateway_merge_request_size_limit(ngx_conf_t *cf,
                                                ngx_http_gateway_conf_t *prev,
                                                ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_request_size_limit(
    ngx_http_request_t *r, ngx_http_gateway_conf_t *conf, ngx_str_t host);

/* Extension: Traffic Split */
char *ngx_http_gateway_merge_traffic_split(ngx_conf_t *cf,
                                           ngx_http_gateway_conf_t *prev,
                                           ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_traffic_split(ngx_http_request_t *r,
                                              ngx_http_gateway_conf_t *conf,
                                              ngx_str_t host);
ngx_int_t ngx_http_gateway_variable_upstream(ngx_http_request_t *r,
                                             ngx_http_variable_value_t *v,
                                             uintptr_t data);
ngx_int_t ngx_http_gateway_variable_split_rule(ngx_http_request_t *r,
                                               ngx_http_variable_value_t *v,
                                               uintptr_t data);

/* Extension: Canary Release */
char *ngx_http_gateway_merge_canary_release(ngx_conf_t *cf,
                                            ngx_http_gateway_conf_t *prev,
                                            ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_canary_release(ngx_http_request_t *r,
                                               ngx_http_gateway_conf_t *conf,
                                               ngx_str_t host);
ngx_int_t ngx_http_gateway_variable_canary_status(ngx_http_request_t *r,
                                                  ngx_http_variable_value_t *v,
                                                  uintptr_t data);

/* Extension: Blue-Green Deployment */
char *ngx_http_gateway_merge_blue_green(ngx_conf_t *cf,
                                        ngx_http_gateway_conf_t *prev,
                                        ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_blue_green(ngx_http_request_t *r,
                                           ngx_http_gateway_conf_t *conf,
                                           ngx_str_t host);
ngx_int_t ngx_http_gateway_variable_deploy_slot(ngx_http_request_t *r,
                                                ngx_http_variable_value_t *v,
                                                uintptr_t data);

/* Extension: Request Mirror */
char *ngx_http_gateway_merge_request_mirror(ngx_conf_t *cf,
                                            ngx_http_gateway_conf_t *prev,
                                            ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_request_mirror(ngx_http_request_t *r,
                                               ngx_http_gateway_conf_t *conf,
                                               ngx_str_t host);
ngx_int_t ngx_http_gateway_variable_mirror_upstream(
    ngx_http_request_t *r, ngx_http_variable_value_t *v, uintptr_t data);
ngx_int_t ngx_http_gateway_variable_mirror_status(ngx_http_request_t *r,
                                                  ngx_http_variable_value_t *v,
                                                  uintptr_t data);

/* Extension: Core WAF */
char *ngx_http_gateway_merge_waf(ngx_conf_t *cf, ngx_http_gateway_conf_t *prev,
                                 ngx_http_gateway_conf_t *conf);
ngx_int_t ngx_http_gateway_eval_waf(ngx_http_request_t *r,
                                    ngx_http_gateway_conf_t *conf,
                                    ngx_str_t host);

/* Telemetry, Variables, and Metrics Handler */
ngx_int_t ngx_http_gateway_telemetry_zone_init(ngx_shm_zone_t *zone,
                                               void *previous);
ngx_int_t ngx_http_gateway_variables(ngx_conf_t *cf);
char *ngx_http_gateway_metrics_directive(ngx_conf_t *cf, ngx_command_t *cmd,
                                         void *conf);
ngx_int_t ngx_http_gateway_metrics_handler(ngx_http_request_t *r);

#endif /* GATEWAY_H */
