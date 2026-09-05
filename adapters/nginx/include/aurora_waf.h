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
uint32_t aurora_waf_evaluate_v3(const AuroraEngine *engine, const uint8_t *path, size_t len, AuroraDecision *out);
uint64_t aurora_waf_generation(const AuroraEngine *engine);
/* Status: 0 OK, 1 invalid input/policy, 2 panic. Action: 0 allow, 1 block. */
uint32_t aurora_waf_create(const uint8_t *data, size_t len, AuroraEngine **out);
uint32_t aurora_waf_evaluate(const AuroraEngine *engine, const uint8_t *path, size_t len, uint32_t *action);
void aurora_waf_destroy(AuroraEngine *engine);

#ifdef __cplusplus
}
#endif
#endif
