#include "aurora_waf.h"
#include <stdio.h>
#include <assert.h>
#include <string.h>

int main(void) {
    const char *policy = "{\"schema_version\":1,\"block_paths\":[\"/blocked\"]}";
    uint32_t action;
    AuroraEngine *engine = NULL;
    AuroraDecision decision;
    _Static_assert(sizeof(AuroraDecision) == 32, "ABI decision layout changed");
    assert(aurora_waf_abi_version() == 3);
    assert(aurora_waf_create(NULL, 0, &engine) == 1 && engine == NULL);
    assert(aurora_waf_create((const uint8_t *)policy, strlen(policy), NULL) == 1);
    assert(aurora_waf_create((const uint8_t *)policy, 65537, &engine) == 1);
    for (int i = 0; i < 1000; i++) {
        assert(aurora_waf_create((const uint8_t *)policy, strlen(policy), &engine) == 0);
        assert(aurora_waf_evaluate_v3(engine, (const uint8_t *)"/blocked", 8, &decision) == 0);
        assert(decision.action == 1 && decision.rule_id == 1 && decision.generation == 0 && decision.reserved == 0);
        assert(aurora_waf_evaluate_v3(engine, (const uint8_t *)"/ok", 3, NULL) == 1);
        assert(aurora_waf_evaluate_v3(NULL, (const uint8_t *)"/ok", 3, &decision) == 1 && decision.action == 1);
        assert(aurora_waf_evaluate(engine, (const uint8_t *)"/blocked", 8, &action) == 0 && action == 1);
        assert(aurora_waf_evaluate(engine, (const uint8_t *)"/ok", 3, &action) == 0 && action == 0);
        assert(aurora_waf_evaluate(engine, NULL, 0, &action) == 1 && action == 1);
        assert(aurora_waf_evaluate(NULL, (const uint8_t *)"/ok", 3, &action) == 1 && action == 1);
        assert(aurora_waf_evaluate(engine, (const uint8_t *)"/ok", 8193, &action) == 1);
        aurora_waf_destroy(engine);
    }
    aurora_waf_destroy(NULL);
    policy = "{\"schema_version\":2,\"generation\":9,\"rules\":[{\"id\":1,\"path\":\"/x\",\"action\":\"log\",\"score\":3,\"priority\":0},{\"id\":2,\"path\":\"/x\",\"action\":\"block\",\"score\":5,\"priority\":1}]}";
    assert(aurora_waf_create((const uint8_t *)policy, strlen(policy), &engine) == 0);
    assert(aurora_waf_generation(engine) == 9);
    assert(aurora_waf_evaluate_v3(engine, (const uint8_t *)"/x", 2, &decision) == 0);
    assert(decision.generation == 9 && decision.rule_id == 2 && decision.action == 1 && decision.score == 8 && decision.log_matches == 1);
    aurora_waf_destroy(engine);
    puts("C -> Rust ABI v3: lifecycle, limits, allow/block, invalid inputs pass");
    return 0;
}
