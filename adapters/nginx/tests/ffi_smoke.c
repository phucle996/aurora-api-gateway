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
    puts("Aurora IP Restriction FFI: create, evaluate block, destroy pass");

    // Test SHM init via file (creates /dev/shm file, maps GATEWAY_METRICS)
    assert(aurora_gateway_init_shm(NULL) == 0);

    // L7: Core request recording
    aurora_gateway_record_request(200, 15);
    aurora_gateway_record_request(404, 3);
    aurora_gateway_record_request(502, 1200);

    // L7: Traffic volume recording
    aurora_gateway_record_traffic(1024, 4096, 1, 1);
    aurora_gateway_record_traffic(512, 2048, 0, 0);

    // L4: Connection gauges
    aurora_gateway_record_connections(10, 2, 4, 4);

    // L4: SSL handshake recording
    aurora_gateway_record_ssl(1, 0);
    aurora_gateway_record_ssl(1, 1);
    aurora_gateway_record_ssl(0, 0);

    // Upstream recording
    aurora_gateway_record_upstream(200, 50, 5, 0);
    aurora_gateway_record_upstream(502, 0, 0, 1);

    // Extension metrics recording
    extension_ip_restriction_record_metrics(1);
    extension_rate_limit_record_metrics(2);
    extension_jwt_record_metrics(0);
    extension_conn_limit_record_metrics(1);
    extension_traffic_shaper_record_metrics(1);
    extension_request_size_record_metrics(1);
    extension_termination_record_metrics();
    extension_traffic_split_record_metrics(1);
    extension_canary_record_metrics(1);
    extension_blue_green_record_metrics(0);
    extension_mirror_record_metrics();

    // Log bus gating
    assert(aurora_gateway_is_log_active() == 0);

    aurora_gateway_stop_shm();
    puts("SHM telemetry: L7/L4/Upstream/Extension metrics recording pass");

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
