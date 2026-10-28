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

#define AURORA_MAX_FORWARD_HEADERS 16

typedef struct {
  uint32_t name_len;
  uint32_t value_len;
  uint8_t name[64];
  uint8_t value[256];
} AuroraHeader;

typedef uint32_t (*aurora_header_lookup_fn)(void *ctx, const uint8_t *name,
                                            size_t name_len,
                                            const uint8_t **out_val,
                                            size_t *out_val_len);

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
  uint32_t random_seed;
  uint64_t now_ms;
} AuroraAccessInput;

typedef struct {
  uint32_t action;
  uint32_t status_code;
  uint32_t flags;

  uint32_t headers_count;
  AuroraHeader headers[AURORA_MAX_FORWARD_HEADERS];

  uint32_t target_upstream_len;
  char target_upstream[128];

  uint64_t rate_limit_bytes_per_sec;

  AuroraReleaseToken release_token;

  uint32_t body_len;
  char body[4096];
  uint32_t content_type_len;
  char content_type[64];
} AuroraAccessOutcome;

uint32_t aurora_gateway_phase_access(
    const AuroraAccessInput *input,
    void *lookup_ctx,
    aurora_header_lookup_fn lookup_fn,
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

typedef struct {
  uint32_t upstream_status;
  uint32_t is_websocket;
} AuroraHeaderFilterInput;

typedef struct {
  uint32_t action;
  uint32_t override_status;
  uint32_t headers_count;
  AuroraHeader headers[8];
} AuroraHeaderFilterOutcome;

uint32_t aurora_gateway_phase_header_filter(const AuroraHeaderFilterInput *input,
                                            AuroraHeaderFilterOutcome *out_outcome);

/* ========================================================================== */
/* Gateway Phase 4: HTTP Body Filter Phase                                    */
/* ========================================================================== */

#define AURORA_BODY_FILTER_PASSTHROUGH 0

typedef struct {
  const uint8_t *chunk;
  size_t chunk_len;
  uint32_t is_last;
} AuroraBodyFilterInput;

typedef struct {
  uint32_t action;
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
} AuroraLogInput;

uint32_t aurora_gateway_phase_log(const AuroraLogInput *input);

void aurora_gateway_in_flight_enter(void);
void aurora_gateway_in_flight_leave(void);
uint64_t aurora_gateway_in_flight_count(void);

#ifdef __cplusplus
}
#endif
#endif /* GATEWAY_FFI_H */
