#define _GNU_SOURCE
#include "aurora_waf.h"
#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdatomic.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>
#include <time.h>

int main(void) {
    const char *policy = "{\"schema_version\":1,\"block_paths\":[\"/blocked\"]}";
    uint32_t action;
    AuroraEngine *engine = NULL;
    AuroraDecision decision;
    _Static_assert(sizeof(AuroraDecision) == 32, "ABI decision layout changed");
    assert(aurora_waf_abi_version() == 4);
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
    // Same shared-memory contract as the NGINX slab zone, with real processes.
    _Atomic uint64_t *shared = mmap(NULL, 4096, PROT_READ | PROT_WRITE,
                                    MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    assert(shared != MAP_FAILED);
    assert(aurora_waf_bind_telemetry(NULL, 64, shared + 8) == 1);
    assert(aurora_waf_bind_telemetry(shared, 63, shared + 8) == 1);
    assert(aurora_waf_bind_telemetry((char *)shared + 1, 64, shared + 8) == 1);
    assert(aurora_waf_bind_telemetry(shared, 64, shared + 8) == 0);
    policy = "{\"schema_version\":1,\"block_paths\":[\"/blocked\"]}";
    assert(aurora_waf_create((const uint8_t *)policy, strlen(policy), &engine) == 0);
    for (int worker = 0; worker < 4; worker++) {
        pid_t pid = fork();
        assert(pid >= 0);
        if (pid == 0) {
            for (int i = 0; i < 100000; i++) {
                assert(aurora_waf_evaluate(engine, (const uint8_t *)"/ok", 3, &action) == 0 && action == 0);
                assert(aurora_waf_evaluate(engine, (const uint8_t *)"/blocked", 8, &action) == 0 && action == 1);
            }
            _exit(0);
        }
    }
    for (int worker = 0; worker < 4; worker++) {
        int status;
        assert(wait(&status) > 0 && WIFEXITED(status) && WEXITSTATUS(status) == 0);
    }
    assert(atomic_load(shared) == 800000);
    assert(atomic_load(shared + 1) == 400000);
    assert(atomic_load(shared + 2) == 400000);
    // A replacement worker binding the existing zone must not reset counters.
    assert(aurora_waf_bind_telemetry(shared, 64, shared + 8) == 0);
    assert(atomic_load(shared) == 800000);
    aurora_waf_destroy(engine);
    uint8_t metrics[4096];
    size_t written = 0;
    assert(aurora_waf_format_prometheus_metrics("node", metrics, sizeof(metrics) - 1, &written) == 0);
    metrics[written] = 0;
    assert(strstr((char *)metrics, "aurora_node_cpu_percent{") == NULL);
    double cpu = 25, memory = 40, rps = 50000;
    uint64_t bits;
    memcpy(&bits, &cpu, sizeof(bits)); atomic_store(shared + 4, bits);
    memcpy(&bits, &memory, sizeof(bits)); atomic_store(shared + 5, bits);
    memcpy(&bits, &rps, sizeof(bits)); atomic_store(shared + 6, bits);
    atomic_store(shared + 8, 12);
    atomic_store(shared + 7, (uint64_t)time(NULL));
    assert(aurora_waf_format_prometheus_metrics("node", metrics, sizeof(metrics) - 1, &written) == 0);
    assert(strstr((char *)metrics, "aurora_node_cpu_percent{") != NULL);
    assert(strstr((char *)metrics, "node_id=\"node\"") != NULL);
    assert(strstr((char *)metrics, "25.00") != NULL);
    assert(strstr((char *)metrics, "aurora_node_active_connections{") != NULL);
    assert(strstr((char *)metrics, " 12") != NULL);
    atomic_store(shared + 7, (uint64_t)time(NULL) - 60);
    assert(aurora_waf_format_prometheus_metrics("node", metrics, sizeof(metrics) - 1, &written) == 0);
    metrics[written] = 0;
    assert(strstr((char *)metrics, "aurora_node_cpu_percent{") == NULL);
    // Bound zone stays alive until process exit, matching the FFI lifetime contract.
    puts("Shared telemetry: 4 processes, 800000 evaluations, exact counters pass");
    puts("C -> Rust ABI v4: lifecycle, limits, allow/block, invalid inputs pass");
    return 0;
}
