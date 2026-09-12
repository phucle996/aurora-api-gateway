#ifndef GATEWAY_FFI_H
#define GATEWAY_FFI_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

uint32_t aurora_waf_abi_version(void);

typedef struct AuroraEngine AuroraEngine;
typedef struct {
    uint64_t generation;
    uint64_t rule_id;
    uint32_t action;
    uint32_t score;
    uint32_t log_matches;
    uint32_t reserved;
} AuroraDecision;

/* Extension: Access Control */
typedef struct AuroraAccessEngine AuroraAccessEngine;
typedef struct {
    const uint8_t *ip; size_t ip_len;
    const uint8_t *host; size_t host_len;
    const uint8_t *path; size_t path_len;
    const uint8_t *method; size_t method_len;
    uint64_t now;
} AuroraAccessInput;

uint32_t aurora_access_create(const uint8_t *data, size_t len, AuroraAccessEngine **out);
void aurora_access_destroy(AuroraAccessEngine *engine);
uint64_t aurora_access_generation(const AuroraAccessEngine *engine);
uint32_t aurora_access_evaluate(const AuroraAccessEngine *engine, const AuroraAccessInput *input, AuroraDecision *out);
uint32_t aurora_access_record_match(uint64_t generation, uint64_t rule_id, const uint8_t *ip, size_t ip_len);
uint32_t aurora_access_swap_engine(const uint8_t *data, size_t len);

/* Extension: Core WAF */
uint32_t aurora_waf_evaluate_v3(const AuroraEngine *engine, const uint8_t *path, size_t len, AuroraDecision *out);
uint32_t aurora_waf_evaluate_v4(const AuroraEngine *engine, const uint8_t *host, size_t host_len, const uint8_t *path, size_t len, AuroraDecision *out);
uint64_t aurora_waf_generation(const AuroraEngine *engine);
uint32_t aurora_waf_create(const uint8_t *data, size_t len, AuroraEngine **out);
uint32_t aurora_waf_evaluate(const AuroraEngine *engine, const uint8_t *path, size_t len, uint32_t *action);
void aurora_waf_destroy(AuroraEngine *engine);
uint32_t aurora_waf_swap_policy(const uint8_t *data, size_t len);

/* Extension: JWT Authentication */
#define AURORA_JWT_MAX_FORWARD_HEADERS 16

typedef struct {
    uint32_t name_len;
    uint32_t value_len;
    u_char name[64];
    u_char value[256];
} AuroraJwtHeader;

typedef struct {
    uint32_t allowed; /* 1 = allow, 0 = unauthorized */
    uint32_t headers_count;
    AuroraJwtHeader headers[AURORA_JWT_MAX_FORWARD_HEADERS];
} AuroraJwtDecision;

typedef struct AuroraJwtEngine AuroraJwtEngine;
uint32_t aurora_jwt_create(const uint8_t *data, size_t len, AuroraJwtEngine **out);
void aurora_jwt_destroy(AuroraJwtEngine *engine);
uint32_t aurora_jwt_evaluate(const AuroraJwtEngine *engine,
    const uint8_t *host, size_t host_len,
    const uint8_t *path, size_t path_len,
    const uint8_t *authorization, size_t authorization_len,
    AuroraJwtDecision *out_decision);

/* Shared: Header lookup callback type for dynamic header inspection */
typedef uint32_t (*aurora_header_lookup_fn)(
    void *ctx,
    const uint8_t *name, size_t name_len,
    const uint8_t **out_val, size_t *out_val_len);

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

uint32_t aurora_rate_limit_create(const uint8_t *data, size_t len, AuroraRateLimitEngine **out);
void aurora_rate_limit_destroy(AuroraRateLimitEngine *engine);
uint32_t aurora_rate_limit_evaluate(const AuroraRateLimitEngine *engine,
    const uint8_t *host, size_t host_len,
    const uint8_t *path, size_t path_len,
    const uint8_t *client_ip, size_t client_ip_len,
    void *lookup_ctx,
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


uint32_t aurora_conn_limit_create(const uint8_t *data, size_t len, AuroraConnectionLimitEngine **out);
void aurora_conn_limit_destroy(AuroraConnectionLimitEngine *engine);
uint32_t aurora_conn_limit_acquire(const AuroraConnectionLimitEngine *engine,
    const uint8_t *host, size_t host_len,
    const uint8_t *path, size_t path_len,
    const uint8_t *client_ip, size_t client_ip_len,
    void *lookup_ctx,
    aurora_header_lookup_fn lookup_fn,
    AuroraConnLimitDecision *out_decision);
uint32_t aurora_conn_limit_release(const AuroraConnectionLimitEngine *engine,
    const AuroraConnLimitToken *token);

/* Control Plane Runtime & Telemetry */
uint32_t aurora_waf_start_runtime(
    const char *controller_url,
    const char *node_id,
    const char *token,
    uint32_t interval_seconds,
    int64_t active_release_id,
    const char *policy_path,
    const char *access_path,
    uint32_t is_leader
);
uint32_t aurora_waf_start_telemetry(const char *controller_url, const char *node_id, const char *token, uint32_t interval_seconds, int64_t active_release_id);
void aurora_waf_stop_telemetry(void);
uint32_t aurora_waf_bind_telemetry(void *shared, size_t len, void *active);
uint32_t aurora_waf_format_prometheus_metrics(const char *node_id, uint8_t *out_buf, size_t max_len, size_t *written_len);

#ifdef __cplusplus
}
#endif
#endif /* GATEWAY_FFI_H */
