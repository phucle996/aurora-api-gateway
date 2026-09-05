#ifndef AURORA_WAF_H
#define AURORA_WAF_H

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
uint32_t aurora_waf_evaluate_v3(const AuroraEngine *engine, const uint8_t *path, size_t len, AuroraDecision *out);
uint32_t aurora_waf_evaluate_v4(const AuroraEngine *engine, const uint8_t *host, size_t host_len, const uint8_t *path, size_t len, AuroraDecision *out);
uint64_t aurora_waf_generation(const AuroraEngine *engine);
/* Status: 0 OK, 1 invalid input/policy, 2 panic. Action: 0 allow, 1 block. */
uint32_t aurora_waf_create(const uint8_t *data, size_t len, AuroraEngine **out);
uint32_t aurora_waf_evaluate(const AuroraEngine *engine, const uint8_t *path, size_t len, uint32_t *action);
void aurora_waf_destroy(AuroraEngine *engine);
uint32_t aurora_waf_start_telemetry(const char *controller_url, const char *node_id, const char *token, uint32_t interval_seconds, int64_t active_release_id);
void aurora_waf_stop_telemetry(void);
/* x86_64/Linux: shared zeroed aligned 64-byte atomic storage; lifetime is the
 * NGINX shared zone, never a request pool. active points to ngx_stat_active. */
uint32_t aurora_waf_bind_telemetry(void *shared, size_t len, void *active);
uint32_t aurora_waf_format_prometheus_metrics(const char *node_id, uint8_t *out_buf, size_t max_len, size_t *written_len);

#ifdef __cplusplus
}
#endif
#endif
