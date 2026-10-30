#ifndef GATEWAY_FFI_H
#define GATEWAY_FFI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ABI Version */
uint32_t aurora_gateway_abi_version(void);

/* Process & Policy Lifecycle */
uint32_t aurora_gateway_process_init(uint32_t worker_id);
void aurora_gateway_process_exit(void);
void aurora_gateway_policy_sync(void);
uint64_t aurora_gateway_policy_generation(void);
uint32_t aurora_gateway_probe_kernel(void);

#define AURORA_CAP_TCP_NOTSENT_LOWAT (1 << 0)
#define AURORA_CAP_SO_INCOMING_CPU   (1 << 1)
#define AURORA_CAP_SO_BUSY_POLL      (1 << 2)
#define AURORA_CAP_TCP_USER_TIMEOUT  (1 << 3)
#define AURORA_CAP_TCP_FASTOPEN      (1 << 4)
#define AURORA_CAP_TCP_BBR           (1 << 5)

/* Dynamic Policy SHM writer for tooling / testing */
uint32_t aurora_gateway_policy_writer_update(uint32_t slot_id, uint64_t generation,
                                             const uint8_t *data, size_t len);
uint32_t aurora_gateway_policy_writer_clear(uint32_t slot_id, uint64_t generation);

/* ========================================================================== */
/* Gateway Phase 1: HTTP Access Phase                                         */
/* ========================================================================== */

#define AURORA_ACTION_ALLOW 0
#define AURORA_ACTION_DENY 1

#define AURORA_FLAG_WWW_AUTH (1 << 0)
#define AURORA_FLAG_HAS_RELEASE_TOKEN (1 << 1)
#define AURORA_FLAG_CACHE_PINNED (1 << 2)

#define AURORA_EXT_IP_RESTRICTION       0
#define AURORA_EXT_JWT                  1
#define AURORA_EXT_RATE_LIMIT           2
#define AURORA_EXT_CONN_LIMIT           3
#define AURORA_EXT_TRAFFIC_SHAPER       4
#define AURORA_EXT_RESOURCE_LIMIT       5
#define AURORA_EXT_TRAFFIC_SPLIT        6
#define AURORA_EXT_CANARY_RELEASE       7
#define AURORA_EXT_BLUE_GREEN           8
#define AURORA_EXT_REQUEST_MIRROR       9
#define AURORA_EXT_REQUEST_TERMINATION  10
#define AURORA_EXT_RESPONSE_COMPRESSION 11
#define AURORA_EXT_RESPONSE_CACHE       12
#define AURORA_SLOT_ROUTE_MASKS         15

#define AURORA_MAX_FORWARD_HEADERS 16

typedef struct {
  const uint8_t *name;
  const uint8_t *value;
  const uint8_t *lowcase_name;
  uint32_t name_len;
  uint32_t value_len;
} AuroraHeader;

typedef uint32_t (*aurora_header_lookup_fn)(void *ctx, const uint8_t *name,
                                            size_t name_len,
                                            const uint8_t **out_val,
                                            size_t *out_val_len);

typedef uint8_t *(*aurora_alloc_fn)(void *ctx, size_t size);

typedef struct {
  uint8_t opaque[64];
} AuroraReleaseToken;

typedef struct {
  const uint8_t *client_ip;
  size_t client_ip_len;
  const uint8_t *host;
  size_t host_len;
  const uint8_t *path;
  size_t path_len;
  const uint8_t *method;
  size_t method_len;
  const uint8_t *query;
  size_t query_len;
  uint64_t content_length;
  uint64_t header_length;
  uint32_t random_seed;
  uint64_t now_ms;
} AuroraAccessInput;

typedef struct {
  uint32_t action;
  uint32_t status_code;
  uint32_t flags;
  uint32_t headers_count;

  AuroraHeader headers[AURORA_MAX_FORWARD_HEADERS];

  const uint8_t *target_upstream;
  const uint8_t *body;
  const uint8_t *content_type;

  uint32_t target_upstream_len;
  uint32_t body_len;
  uint32_t content_type_len;
  uint32_t route_mask;

  uint64_t rate_limit_bytes_per_sec;

  AuroraReleaseToken release_token;
} AuroraAccessOutcome;

uint32_t aurora_gateway_phase_access(
    const AuroraAccessInput *input,
    void *lookup_ctx,
    aurora_header_lookup_fn lookup_fn,
    aurora_alloc_fn alloc_fn,
    AuroraAccessOutcome *out_outcome);

void aurora_gateway_connection_release(const AuroraReleaseToken *token);

/* ========================================================================== */
/* Gateway Phase 2: HTTP Content Phase                                        */
/* ========================================================================== */

typedef struct {
  const uint8_t *host;
  size_t host_len;
  const uint8_t *path;
  size_t path_len;
  const uint8_t *method;
  size_t method_len;
  const uint8_t *query;
  size_t query_len;
} AuroraContentInput;

typedef struct {
  uint32_t status_code;
  uint32_t content_type_len;
  uint8_t content_type[64];
  uint32_t body_len;
  uint8_t *body;
  size_t body_cap;
} AuroraContentOutcome;

uint32_t aurora_gateway_phase_content(const AuroraContentInput *input,
                                      AuroraContentOutcome *out_outcome);

/* ========================================================================== */
/* Gateway Phase 3: HTTP Header Filter Phase                                  */
/* ========================================================================== */

#define AURORA_FILTER_PASSTHROUGH 0
#define AURORA_FILTER_MUTATE 1
#define AURORA_FILTER_COMPRESS 2

typedef struct {
  uint32_t upstream_status;
  uint32_t is_websocket;
  const uint8_t *path;
  size_t path_len;
  const uint8_t *content_type;
  size_t content_type_len;
  size_t content_length;
  const uint8_t *accept_encoding;
  size_t accept_encoding_len;
} AuroraHeaderFilterInput;

typedef struct {
  uint32_t action;
  uint32_t override_status;
  uint32_t headers_count;
  AuroraHeader headers[8];
  uint32_t compression_algorithm;
  const uint8_t *content_encoding_str;
  size_t content_encoding_len;
} AuroraHeaderFilterOutcome;

uint32_t aurora_gateway_phase_header_filter(const AuroraHeaderFilterInput *input,
                                            AuroraHeaderFilterOutcome *out_outcome);

/* ========================================================================== */
/* Gateway Phase 4: HTTP Body Filter Phase                                    */
/* ========================================================================== */

#define AURORA_BODY_FILTER_PASSTHROUGH 0
#define AURORA_BODY_FILTER_MUTATED 1

typedef struct {
  const uint8_t *chunk;
  size_t chunk_len;
  uint32_t is_last;
  uint32_t compression_algorithm;
  void *alloc_ctx;
  aurora_alloc_fn alloc_fn;
} AuroraBodyFilterInput;

typedef struct {
  uint32_t action;
  uint8_t *out_ptr;
  size_t out_len;
} AuroraBodyFilterOutcome;

uint32_t aurora_gateway_phase_body_filter(const AuroraBodyFilterInput *input,
                                          AuroraBodyFilterOutcome *out_outcome);

/* ========================================================================== */
/* Gateway Phase 5: HTTP Log Phase & Live Observability Gauges                */
/* ========================================================================== */

typedef struct {
  const uint8_t *client_ip;
  size_t client_ip_len;
  const uint8_t *method;
  size_t method_len;
  const uint8_t *uri;
  size_t uri_len;
  const uint8_t *host;
  size_t host_len;
  const uint8_t *user_agent;
  size_t user_agent_len;
  const uint8_t *request_id;
  size_t request_id_len;
  const uint8_t *trace_id;
  size_t trace_id_len;
  uint32_t status;
  uint32_t duration_ms;
  uint64_t bytes_sent;
  uint64_t bytes_recv;
  uint32_t upstream_status;
  uint32_t upstream_response_ms;
  uint32_t upstream_connect_ms;
  uint32_t is_ssl;
  uint32_t ssl_reused;
  uint32_t is_matched;
  uint64_t active_conns;
  uint64_t reading_conns;
  uint64_t writing_conns;
  uint64_t waiting_conns;
  uint64_t timestamp_unix_nano;
} AuroraLogInput;

#define AURORA_SUB_STD_LOG    (1 << 0)
#define AURORA_SUB_METRICS    (1 << 1)
#define AURORA_SUB_TRACING    (1 << 2)

extern const volatile uint32_t AURORA_TELEMETRY_SUBSCRIBERS;

uint32_t aurora_gateway_has_log_subscribers(void);
void aurora_gateway_telemetry_subscribe(uint32_t mask);
void aurora_gateway_telemetry_unsubscribe(uint32_t mask);
void aurora_gateway_set_log_path(const uint8_t *ptr, size_t len);

uint32_t aurora_gateway_phase_log(const AuroraLogInput *input);

void aurora_gateway_in_flight_enter(void);
void aurora_gateway_in_flight_leave(void);
uint64_t aurora_gateway_in_flight_count(void);

/* ========================================================================== */
/* Gateway Cache Substrate & Zero-Copy Lifecycle                              */
/* ========================================================================== */

typedef struct {
  const uint8_t *method;
  size_t method_len;
  const uint8_t *host;
  size_t host_len;
  const uint8_t *path;
  size_t path_len;
  const uint8_t *query;
  size_t query_len;
  uint32_t status;
  const uint8_t *content_type;
  size_t content_type_len;
  const uint8_t *body;
  size_t body_len;
  const uint8_t *cache_control;
  size_t cache_control_len;
  const uint8_t *etag;
  size_t etag_len;
} AuroraCacheStoreInput;

void aurora_release_cache_entry(void *data);
uint32_t aurora_gateway_phase_cache_store(const AuroraCacheStoreInput *input);

#ifdef __cplusplus
}
#endif
#endif /* GATEWAY_FFI_H */
