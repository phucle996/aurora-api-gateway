#ifndef GATEWAY_H
#define GATEWAY_H

#include <ngx_config.h>
#include <ngx_core.h>
#include <ngx_http.h>
#include "ffi.h"

/*
 * Cấu hình Gateway cho từng location / server block trong NGINX.
 * Hoàn toàn là Phase Bridge, không chứa bất kỳ logic hay cấu hình của extension nào.
 */
typedef struct {
  ngx_flag_t enabled; /* Bật/tắt Gateway (on/off) */
} ngx_http_gateway_conf_t;

typedef struct {
  ngx_str_t target_upstream;
  ngx_uint_t evaluated;
} ngx_http_gateway_ctx_t;

extern ngx_module_t ngx_http_gateway_module;

typedef struct {
  AuroraReleaseToken token;
} ngx_http_gateway_conn_token_ctx_t;

void ngx_http_gateway_conn_token_req_cleanup(void *data);

/* Pipeline Access Phase Handler */
ngx_int_t ngx_http_gateway_handler(ngx_http_request_t *r);

/* Shared: header lookup callback */
uint32_t ngx_http_gateway_header_lookup(void *ctx, const uint8_t *name,
                                        size_t name_len,
                                        const uint8_t **out_val,
                                        size_t *out_val_len);

/* NGINX Variable Getters */
ngx_int_t ngx_http_gateway_variables(ngx_conf_t *cf);
ngx_int_t ngx_http_gateway_variable_upstream(ngx_http_request_t *r,
                                             ngx_http_variable_value_t *v,
                                             uintptr_t data);

/* Content and Telemetry Handlers */
char *ngx_http_gateway_metrics_directive(ngx_conf_t *cf, ngx_command_t *cmd,
                                         void *conf);
ngx_int_t ngx_http_gateway_metrics_handler(ngx_http_request_t *r);
ngx_int_t ngx_http_gateway_log_handler(ngx_http_request_t *r);

#endif /* GATEWAY_H */
