#ifndef GATEWAY_FFI_H
#define GATEWAY_FFI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

uint32_t aurora_gateway_abi_version(void);

typedef struct {
  uint64_t generation;
  uint64_t rule_id;
  uint32_t action;
  uint32_t score;
  uint32_t log_matches;
  uint32_t reserved;
} AuroraDecision;

/* Extension: IP Restriction (formerly Access Control) */
typedef struct AuroraIpRestrictionEngine AuroraIpRestrictionEngine;
typedef struct {
  const uint8_t *ip;
  size_t ip_len;
  const uint8_t *host;
  size_t host_len;
  const uint8_t *path;
  size_t path_len;
  const uint8_t *method;
  size_t method_len;
  uint64_t now;
} AuroraIpRestrictionInput;

uint32_t aurora_ip_restriction_create(const uint8_t *data, size_t len,
                                      AuroraIpRestrictionEngine **out);
void aurora_ip_restriction_destroy(AuroraIpRestrictionEngine *engine);
uint64_t
aurora_ip_restriction_generation(const AuroraIpRestrictionEngine *engine);
uint32_t aurora_ip_restriction_evaluate(const AuroraIpRestrictionEngine *engine,
                                        const AuroraIpRestrictionInput *input,
                                        AuroraDecision *out);

/* Extension: JWT Authentication */
#define AURORA_JWT_MAX_FORWARD_HEADERS 16

typedef struct {
  uint32_t name_len;
  uint32_t value_len;
  uint8_t name[64];
  uint8_t value[256];
} AuroraJwtHeader;

typedef struct {
  uint32_t allowed; /* 1 = allow, 0 = unauthorized */
  uint32_t headers_count;
  AuroraJwtHeader headers[AURORA_JWT_MAX_FORWARD_HEADERS];
} AuroraJwtDecision;

typedef struct AuroraJwtEngine AuroraJwtEngine;
uint32_t aurora_jwt_create(const uint8_t *data, size_t len,
                           AuroraJwtEngine **out);
void aurora_jwt_destroy(AuroraJwtEngine *engine);
uint32_t aurora_jwt_evaluate(const AuroraJwtEngine *engine, const uint8_t *host,
                             size_t host_len, const uint8_t *path,
                             size_t path_len, const uint8_t *authorization,
                             size_t authorization_len,
                             AuroraJwtDecision *out_decision);

/* Shared: Header lookup callback type for dynamic header inspection */
typedef uint32_t (*aurora_header_lookup_fn)(void *ctx, const uint8_t *name,
                                            size_t name_len,
                                            const uint8_t **out_val,
                                            size_t *out_val_len);

/* Extension: Rate Limiting */
#define AURORA_RATE_LIMIT_MAX_HEADERS 8
#define AURORA_RATE_LIMIT_MAX_BODY 2048

typedef struct {
  uint32_t name_len;
  uint32_t value_len;
  uint8_t name[64];
  uint8_t value[256];
} AuroraRateLimitHeader;

typedef struct AuroraRateLimitEngine AuroraRateLimitEngine;
typedef struct {
  uint32_t allowed;
  uint32_t action;
  uint32_t status_code;
  uint32_t retry_after_secs;
  uint32_t remaining;
  uint64_t reset_epoch_secs;
  uint32_t headers_count;
  AuroraRateLimitHeader headers[AURORA_RATE_LIMIT_MAX_HEADERS];
  uint32_t body_len;
  uint8_t body[AURORA_RATE_LIMIT_MAX_BODY];
} AuroraRateLimitDecision;

uint32_t aurora_rate_limit_create(const uint8_t *data, size_t len,
                                  AuroraRateLimitEngine **out);
void aurora_rate_limit_destroy(AuroraRateLimitEngine *engine);
uint32_t aurora_rate_limit_evaluate(const AuroraRateLimitEngine *engine,
                                    const uint8_t *host, size_t host_len,
                                    const uint8_t *path, size_t path_len,
                                    const uint8_t *client_ip,
                                    size_t client_ip_len, void *lookup_ctx,
                                    aurora_header_lookup_fn lookup_fn,
                                    AuroraRateLimitDecision *out_decision);

/* Extension: Connection Limiting */
#define AURORA_CONN_LIMIT_MAX_HEADERS 8
#define AURORA_CONN_LIMIT_MAX_BODY 2048

typedef struct {
  uint32_t name_len;
  uint32_t value_len;
  uint8_t name[64];
  uint8_t value[256];
} AuroraConnLimitHeader;

typedef struct {
  uint32_t is_redis;
  uint32_t rule_id_len;
  uint8_t rule_id[128];
  uint32_t identifier_len;
  uint8_t identifier[128];
} AuroraConnLimitToken;

typedef struct AuroraConnectionLimitEngine AuroraConnectionLimitEngine;

typedef struct {
  uint32_t allowed;
  uint32_t action;
  uint32_t status_code;
  uint32_t current_connections;
  uint32_t max_connections;
  uint32_t has_token;
  AuroraConnLimitToken token;
  uint32_t headers_count;
  AuroraConnLimitHeader headers[AURORA_CONN_LIMIT_MAX_HEADERS];
  uint32_t body_len;
  uint8_t body[AURORA_CONN_LIMIT_MAX_BODY];
} AuroraConnLimitDecision;

uint32_t aurora_conn_limit_create(const uint8_t *data, size_t len,
                                  AuroraConnectionLimitEngine **out);
void aurora_conn_limit_destroy(AuroraConnectionLimitEngine *engine);
uint32_t aurora_conn_limit_acquire(const AuroraConnectionLimitEngine *engine,
                                   const uint8_t *host, size_t host_len,
                                   const uint8_t *path, size_t path_len,
                                   const uint8_t *client_ip,
                                   size_t client_ip_len, void *lookup_ctx,
                                   aurora_header_lookup_fn lookup_fn,
                                   AuroraConnLimitDecision *out_decision);
uint32_t aurora_conn_limit_release(const AuroraConnectionLimitEngine *engine,
                                   const AuroraConnLimitToken *token);

/* ========================================================================== */
/* Extension: Traffic Shaper Types & FFI                                      */
/* ========================================================================== */

typedef struct AuroraTrafficShaperEngine AuroraTrafficShaperEngine;

typedef struct {
  uint64_t rate_bytes_per_sec;
  uint64_t burst_bytes;
  uint32_t matched;
  uint32_t rule_id_len;
  char rule_id[128];
} AuroraTrafficShaperDecision;

uint32_t aurora_traffic_shaper_create(const uint8_t *data, size_t len,
                                      AuroraTrafficShaperEngine **out);
void aurora_traffic_shaper_destroy(AuroraTrafficShaperEngine *engine);
uint32_t aurora_traffic_shaper_evaluate(
    const AuroraTrafficShaperEngine *engine, const uint8_t *host,
    size_t host_len, const uint8_t *path, size_t path_len,
    const uint8_t *client_ip, size_t client_ip_len, void *lookup_ctx,
    aurora_header_lookup_fn lookup_fn,
    AuroraTrafficShaperDecision *out_decision);

/* ========================================================================== */
/* Extension: Request Size Limit Types & FFI                                  */
/* ========================================================================== */

typedef struct AuroraRequestSizeLimitEngine AuroraRequestSizeLimitEngine;

typedef struct {
  uint32_t allowed;
  uint16_t status_code;
  uint32_t matched;
  uint32_t rule_id_len;
  char rule_id[128];
  uint32_t body_len;
  char body[4096];
} AuroraRequestSizeDecision;

uint32_t aurora_request_size_limit_create(const uint8_t *data, size_t len,
                                          AuroraRequestSizeLimitEngine **out);
void aurora_request_size_limit_destroy(AuroraRequestSizeLimitEngine *engine);
uint32_t aurora_request_size_limit_evaluate(
    const AuroraRequestSizeLimitEngine *engine, const uint8_t *origin,
    size_t origin_len, const uint8_t *path, size_t path_len,
    const uint8_t *client_ip, size_t client_ip_len, uint64_t header_bytes,
    uint64_t body_bytes, void *lookup_ctx, aurora_header_lookup_fn lookup_fn,
    AuroraRequestSizeDecision *out_decision);

/* ========================================================================== */
/* Extension: Traffic Split Types & FFI                                       */
/* ========================================================================== */

typedef struct AuroraTrafficSplitEngine AuroraTrafficSplitEngine;

typedef struct {
  uint32_t matched;
  uint32_t rule_id_len;
  char rule_id[128];
  uint32_t upstream_len;
  char upstream[128];
} AuroraTrafficSplitDecision;

uint32_t aurora_traffic_split_create(const uint8_t *data, size_t len,
                                     AuroraTrafficSplitEngine **out);
void aurora_traffic_split_destroy(AuroraTrafficSplitEngine *engine);
uint32_t aurora_traffic_split_evaluate(
    const AuroraTrafficSplitEngine *engine, const uint8_t *origin,
    size_t origin_len, const uint8_t *path, size_t path_len,
    const uint8_t *client_ip, size_t client_ip_len, uint32_t random_seed,
    void *lookup_ctx, aurora_header_lookup_fn lookup_fn,
    AuroraTrafficSplitDecision *out_decision);

/* ========================================================================== */
/* Extension: Canary Release Types & FFI                                      */
/* ========================================================================== */

typedef struct AuroraCanaryReleaseEngine AuroraCanaryReleaseEngine;

typedef struct {
  uint32_t name_len;
  uint8_t name[64];
  uint32_t value_len;
  uint8_t value[256];
} AuroraUpstreamHeader;

typedef struct {
  uint32_t matched;
  uint32_t is_canary;
  uint32_t rule_id_len;
  char rule_id[128];
  uint32_t upstream_len;
  char upstream[128];
  uint32_t headers_count;
  AuroraUpstreamHeader headers[16];
} AuroraCanaryDecision;

uint32_t aurora_canary_release_create(const uint8_t *data, size_t len,
                                      AuroraCanaryReleaseEngine **out);
void aurora_canary_release_destroy(AuroraCanaryReleaseEngine *engine);
uint32_t aurora_canary_release_evaluate(
    const AuroraCanaryReleaseEngine *engine, const uint8_t *origin,
    size_t origin_len, const uint8_t *path, size_t path_len, const uint8_t *uri,
    size_t uri_len, const uint8_t *query, size_t query_len,
    const uint8_t *client_ip, size_t client_ip_len, uint32_t random_seed,
    void *lookup_ctx, aurora_header_lookup_fn lookup_fn,
    AuroraCanaryDecision *out_decision);

/* ========================================================================== */
/* Extension: Blue-Green Deployment Types & FFI                               */
/* ========================================================================== */

typedef struct AuroraBlueGreenEngine AuroraBlueGreenEngine;

typedef struct {
  uint32_t matched;
  uint32_t is_header_override;
  uint32_t rule_id_len;
  char rule_id[128];
  uint32_t upstream_len;
  char upstream[128];
  uint32_t active_slot_len;
  char active_slot[16];
  uint32_t headers_count;
  AuroraUpstreamHeader headers[16];
} AuroraBlueGreenDecision;

uint32_t aurora_blue_green_create(const uint8_t *data, size_t len,
                                  AuroraBlueGreenEngine **out);
void aurora_blue_green_destroy(AuroraBlueGreenEngine *engine);
uint32_t aurora_blue_green_evaluate(const AuroraBlueGreenEngine *engine,
                                    const uint8_t *origin, size_t origin_len,
                                    const uint8_t *path, size_t path_len,
                                    void *lookup_ctx,
                                    aurora_header_lookup_fn lookup_fn,
                                    AuroraBlueGreenDecision *out_decision);

/* ========================================================================== */
/* Extension: Request Mirror Types & FFI                                      */
/* ========================================================================== */

typedef struct AuroraRequestMirrorEngine AuroraRequestMirrorEngine;

typedef struct {
  uint32_t matched;
  uint32_t is_mirrored;
  uint32_t rule_id_len;
  char rule_id[128];
  uint32_t primary_upstream_len;
  char primary_upstream[128];
  uint32_t mirror_upstream_len;
  char mirror_upstream[128];
  uint32_t headers_count;
  AuroraUpstreamHeader headers[16];
} AuroraMirrorDecision;

uint32_t aurora_request_mirror_create(const uint8_t *data, size_t len,
                                      AuroraRequestMirrorEngine **out);
void aurora_request_mirror_destroy(AuroraRequestMirrorEngine *engine);
uint32_t aurora_request_mirror_evaluate(const AuroraRequestMirrorEngine *engine,
                                        const uint8_t *origin,
                                        size_t origin_len, const uint8_t *path,
                                        size_t path_len, const uint8_t *method,
                                        size_t method_len, uint32_t random_seed,
                                        AuroraMirrorDecision *out_decision);

/* Extension: Request Termination */
typedef struct AuroraRequestTerminationEngine AuroraRequestTerminationEngine;

typedef struct {
  const uint8_t *name_ptr;
  size_t name_len;
  const uint8_t *value_ptr;
  size_t value_len;
} AuroraIncomingHeader;

typedef struct {
  uint32_t matched;
  uint32_t should_terminate;
  uint32_t status_code;
  uint32_t rule_id_len;
  char rule_id[128];
  uint32_t content_type_len;
  char content_type[128];
  uint32_t body_len;
  const char *body;
  uint32_t headers_count;
  AuroraUpstreamHeader headers[16];
} AuroraTerminationDecision;

uint32_t
aurora_request_termination_create(const uint8_t *data, size_t len,
                                  AuroraRequestTerminationEngine **out);
void aurora_request_termination_destroy(AuroraRequestTerminationEngine *engine);
uint32_t aurora_request_termination_evaluate(
    const AuroraRequestTerminationEngine *engine, const uint8_t *origin,
    size_t origin_len, const uint8_t *path, size_t path_len,
    const uint8_t *method, size_t method_len,
    const AuroraIncomingHeader *headers, size_t headers_count,
    AuroraTerminationDecision *out_decision);

/* SHM & Telemetry Lifecycle */
void aurora_gateway_stop_shm(void);
uint32_t aurora_gateway_bind_shm(void *shared, size_t len, void *active);
uint32_t aurora_gateway_init_shm(const char *path);

void aurora_gateway_stop_telemetry(void);
uint32_t aurora_gateway_bind_telemetry(void *shared, size_t len, void *active);

/* SHM L7 Metric Objects (Zero-copy, lockless atomic layout) */
typedef struct {
  uint64_t requests_total;
  uint64_t status_2xx;
  uint64_t status_3xx;
  uint64_t status_4xx;
  uint64_t status_5xx;
  uint64_t status_other;
  uint64_t duration_bucket_1ms;
  uint64_t duration_bucket_5ms;
  uint64_t duration_bucket_10ms;
  uint64_t duration_bucket_50ms;
  uint64_t duration_bucket_100ms;
  uint64_t duration_bucket_500ms;
  uint64_t duration_bucket_1000ms;
  uint64_t duration_bucket_inf;
  uint64_t duration_sum_ms;
} aurora_gateway_http_metrics_t;

typedef struct {
  uint64_t request_bytes_in;
  uint64_t response_bytes_out;
  uint64_t requests_ssl;
  uint64_t requests_matched;
} aurora_gateway_l7_traffic_metrics_t;

/* SHM L4 Metric Objects */
typedef struct {
  uint64_t active;
  uint64_t reading;
  uint64_t writing;
  uint64_t waiting;
} aurora_gateway_connection_metrics_t;

typedef struct {
  uint64_t handshakes_total;
  uint64_t handshakes_failed;
  uint64_t sessions_reused;
} aurora_gateway_ssl_metrics_t;

/* SHM Upstream Metric Objects */
typedef struct {
  uint64_t requests_total;
  uint64_t responses_2xx;
  uint64_t responses_5xx;
  uint64_t response_time_sum_ms;
  uint64_t connect_time_sum_ms;
  uint64_t failures;
} aurora_gateway_upstream_metrics_t;

/* SHM Extension Metric Objects */
typedef struct {
  uint64_t allow;
  uint64_t block;
} aurora_gateway_ip_restriction_metrics_t;

typedef struct {
  uint64_t allowed;
  uint64_t throttled;
  uint64_t rejected;
} aurora_gateway_ratelimit_metrics_t;

typedef struct {
  uint64_t valid;
  uint64_t invalid;
  uint64_t expired;
  uint64_t missing;
} aurora_gateway_jwt_metrics_t;

typedef struct {
  uint64_t rejected;
} aurora_gateway_conn_limit_metrics_t;

typedef struct {
  uint64_t delayed;
} aurora_gateway_traffic_shaper_metrics_t;

typedef struct {
  uint64_t rejected;
} aurora_gateway_request_size_metrics_t;

typedef struct {
  uint64_t triggered;
} aurora_gateway_termination_metrics_t;

typedef struct {
  uint64_t primary;
  uint64_t secondary;
} aurora_gateway_traffic_split_metrics_t;

typedef struct {
  uint64_t baseline;
  uint64_t canary;
} aurora_gateway_canary_metrics_t;

typedef struct {
  uint64_t blue;
  uint64_t green;
} aurora_gateway_blue_green_metrics_t;

typedef struct {
  uint64_t sampled;
} aurora_gateway_mirror_metrics_t;

/* SHM Infra Metric Objects */
typedef struct {
  uint64_t active_consumers;
} aurora_gateway_log_bus_metrics_t;

/* Master SHM Layout (4096 bytes, must match Rust GatewaySharedMetrics exactly)
 */
typedef struct {
  uint32_t magic;
  uint32_t version;
  uint64_t generation;

  /* L7 */
  aurora_gateway_http_metrics_t http;
  aurora_gateway_l7_traffic_metrics_t l7_traffic;

  /* L4 */
  aurora_gateway_connection_metrics_t connections;
  aurora_gateway_ssl_metrics_t ssl;

  /* Upstream */
  aurora_gateway_upstream_metrics_t upstream;

  /* Extensions */
  aurora_gateway_ip_restriction_metrics_t ip_restriction;
  aurora_gateway_ratelimit_metrics_t ratelimit;
  aurora_gateway_jwt_metrics_t jwt;
  aurora_gateway_conn_limit_metrics_t conn_limit;
  aurora_gateway_traffic_shaper_metrics_t traffic_shaper;
  aurora_gateway_request_size_metrics_t request_size;
  aurora_gateway_termination_metrics_t termination;
  aurora_gateway_traffic_split_metrics_t traffic_split;
  aurora_gateway_canary_metrics_t canary;
  aurora_gateway_blue_green_metrics_t blue_green;
  aurora_gateway_mirror_metrics_t mirror;

  /* Infra */
  aurora_gateway_log_bus_metrics_t log_bus;

  uint8_t _reserved[4096 - 440];
} aurora_gateway_shared_metrics_t;

/* L7 Gateway SHM Metrics Recording */
void aurora_gateway_record_request(uint32_t status, uint64_t duration_ms);
void aurora_gateway_record_traffic(uint64_t bytes_in, uint64_t bytes_out,
                                   uint32_t is_ssl, uint32_t is_matched);

/* L4 Gateway SHM Metrics Recording */
void aurora_gateway_record_connections(uint64_t active, uint64_t reading,
                                       uint64_t writing, uint64_t waiting);
void aurora_gateway_record_ssl(uint32_t handshake_ok, uint32_t reused);

/* Upstream SHM Metrics Recording */
void aurora_gateway_record_upstream(uint32_t status, uint64_t response_ms,
                                    uint64_t connect_ms, uint32_t failed);

/* Extension Metrics Recording */
void extension_ip_restriction_record_metrics(uint32_t action);
void extension_rate_limit_record_metrics(uint32_t action);
void extension_jwt_record_metrics(uint32_t status);
void extension_conn_limit_record_metrics(uint32_t blocked);
void extension_traffic_shaper_record_metrics(uint32_t delayed);
void extension_request_size_record_metrics(uint32_t rejected);
void extension_termination_record_metrics(void);
void extension_traffic_split_record_metrics(uint32_t secondary);
void extension_canary_record_metrics(uint32_t is_canary);
void extension_blue_green_record_metrics(uint32_t is_green);
void extension_mirror_record_metrics(void);

/* SHM Logs Bus Gating */
uint32_t aurora_gateway_is_log_active(void);
uint64_t aurora_gateway_active_log_consumers(void);

#ifdef __cplusplus
}
#endif
#endif /* GATEWAY_FFI_H */
