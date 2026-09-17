#define _GNU_SOURCE
#include "ffi.h"
#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdatomic.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>
#include <time.h>

int main(void) {
    AuroraDecision decision;
    _Static_assert(sizeof(AuroraDecision) == 32, "ABI decision layout changed");
    assert(aurora_gateway_abi_version() == 4);
    assert(aurora_waf_abi_version() == 4);

    // 1. IP Restriction Extension Test (Canonical API)
    const char *ip_policy = "{\"schema_version\":1,\"generation\":9,\"rules\":[{\"id\":101,\"priority\":1,\"action\":\"block\",\"networks\":[\"192.168.1.0/24\"],\"host\":\"*\",\"path_prefix\":\"/admin\",\"method\":\"*\",\"schedule\":\"always\",\"expires_at\":0,\"log\":true,\"reputation\":false,\"alert\":false}]}";
    AuroraIpRestrictionEngine *ip_engine = NULL;
    assert(aurora_ip_restriction_create(NULL, 0, &ip_engine) == 1 && ip_engine == NULL);
    assert(aurora_ip_restriction_create((const uint8_t *)ip_policy, strlen(ip_policy), &ip_engine) == 0);
    assert(aurora_ip_restriction_generation(ip_engine) == 9);

    const uint8_t ip[] = "192.168.1.50";
    const uint8_t host[] = "example.com";
    const uint8_t path[] = "/admin/users";
    const uint8_t method[] = "GET";
    AuroraIpRestrictionInput input = {
        .ip = ip,
        .ip_len = strlen((const char *)ip),
        .host = host,
        .host_len = strlen((const char *)host),
        .path = path,
        .path_len = strlen((const char *)path),
        .method = method,
        .method_len = strlen((const char *)method),
        .now = 1000,
    };
    assert(aurora_ip_restriction_evaluate(ip_engine, &input, &decision) == 0);
    assert(decision.action == 1 && decision.rule_id == 101 && decision.generation == 9);

    aurora_ip_restriction_destroy(ip_engine);
    aurora_ip_restriction_destroy(NULL);

    // 2. IP Restriction Backward Compatibility Aliases (aurora_access_*)
    AuroraAccessEngine *access_engine = NULL;
    assert(aurora_access_create((const uint8_t *)ip_policy, strlen(ip_policy), &access_engine) == 0);
    assert(aurora_access_generation(access_engine) == 9);
    assert(aurora_access_evaluate(access_engine, (AuroraAccessInput *)&input, &decision) == 0);
    assert(decision.action == 1);
    aurora_access_destroy(access_engine);
    puts("Aurora IP Restriction & Access Aliases FFI: create, evaluate block, destroy pass");

    // 4. Shared Memory (SHM) Telemetry Contract
    _Atomic uint64_t *shared = mmap(NULL, 4096, PROT_READ | PROT_WRITE,
                                    MAP_SHARED | MAP_ANONYMOUS, -1, 0);
    assert(shared != MAP_FAILED);
    assert(aurora_gateway_bind_shm(NULL, 64, shared + 8) == 1);
    assert(aurora_gateway_bind_shm(shared, 63, shared + 8) == 1);
    assert(aurora_gateway_bind_shm((char *)shared + 1, 64, shared + 8) == 1);
    assert(aurora_gateway_bind_shm(shared, 64, shared + 8) == 0);

    for (int worker = 0; worker < 4; worker++) {
        pid_t pid = fork();
        assert(pid >= 0);
        if (pid == 0) {
            for (int i = 0; i < 100000; i++) {
                aurora_gateway_record_pipeline(0);
                aurora_gateway_record_pipeline(1);
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
    assert(aurora_gateway_bind_shm(shared, 64, shared + 8) == 0);
    assert(atomic_load(shared) == 800000);

    // Test log bus gating
    assert(aurora_gateway_is_log_active() == 0);
    assert(aurora_telemetry_is_log_active() == 0);

    // Test metrics recording
    aurora_gateway_record_request(200, 15);
    aurora_gateway_record_ip_restriction(1);
    aurora_gateway_record_connections(10, 2, 4, 4);

    puts("Shared telemetry: 4 processes, 800000 evaluations, exact counters pass");

    // 5. Rate Limit FFI smoke test
    const char *rl_policy = "{\"schema_version\":1,\"generation\":1,\"algorithm\":\"token_bucket\",\"memory_size_mb\":10,\"max_keys\":10000,\"eviction_policy\":\"lru\",\"overflow_strategy\":\"evict_and_track\",\"rules\":[{\"id\":\"r1\",\"host\":\"*\",\"path_prefix\":\"/rl\",\"limit_by\":\"client_ip\",\"rate\":1,\"burst\":1,\"period_secs\":10,\"action_on_exceeded\":\"throttle\"}]}";
    AuroraRateLimitEngine *rl_engine = NULL;
    assert(aurora_rate_limit_create((const uint8_t *)rl_policy, strlen(rl_policy), &rl_engine) == 0);
    assert(rl_engine != NULL);
    AuroraRateLimitDecision rl_dec;
    memset(&rl_dec, 0, sizeof(rl_dec));
    assert(aurora_rate_limit_evaluate(rl_engine, (const uint8_t *)"test.local", 10, (const uint8_t *)"/rl/test", 8, (const uint8_t *)"10.0.0.1", 8, NULL, NULL, &rl_dec) == 0);
    assert(rl_dec.allowed == 1);
    assert(aurora_rate_limit_evaluate(rl_engine, (const uint8_t *)"test.local", 10, (const uint8_t *)"/rl/test", 8, (const uint8_t *)"10.0.0.1", 8, NULL, NULL, &rl_dec) == 0);
    assert(rl_dec.allowed == 0 && rl_dec.action == 1 && rl_dec.status_code == 429);
    aurora_rate_limit_destroy(rl_engine);
    puts("Aurora Rate Limit FFI: create, evaluate 1st allow, 2nd throttle, destroy pass");

    puts("C -> Rust ABI v4: lifecycle, limits, allow/block, invalid inputs pass");
    return 0;
}
