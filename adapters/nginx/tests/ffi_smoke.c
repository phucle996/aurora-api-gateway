#define _GNU_SOURCE
#include "ffi.h"
#include <stdio.h>
#include <stdlib.h>
#include <assert.h>
#include <string.h>
#include <stdatomic.h>
#include <sys/mman.h>
#include <sys/wait.h>
#include <unistd.h>
#include <time.h>

static uint8_t *smoke_alloc(void *ctx, size_t size) {
    (void)ctx;
    return (uint8_t *)malloc(size);
}

int main(void) {
    // 1. ABI Version Validation
    assert(aurora_gateway_abi_version() == 4);

    // 2. Gateway Process Initialization (SHM, Shadow Worker, and Policy Space)
    assert(aurora_gateway_process_init(0) == 0);
    uint32_t caps = aurora_gateway_probe_kernel();
    printf("Kernel Acceleration Capabilities: 0x%04x\n", caps);
    puts("Gateway Process Initialization: pass");

    const char *ip_policy = "{\"schema_version\":1,\"generation\":9,\"rules\":[{\"id\":101,\"priority\":1,\"action\":\"block\",\"networks\":[\"192.168.1.0/24\"],\"host\":\"*\",\"path_prefix\":\"/admin\",\"method\":\"*\",\"schedule\":\"always\",\"expires_at\":0,\"log\":true,\"reputation\":false,\"alert\":false}]}";

    // 3. Dynamic Policy Hot-Swap via SHM & Out-of-band Sync
    assert(aurora_gateway_policy_writer_update(0, 10, (const uint8_t *)ip_policy, strlen(ip_policy)) == 0);
    aurora_gateway_policy_sync();
    puts("Dynamic Policy SHM & Out-of-band Sync: pass");

    // 4. Gateway Phase 1: HTTP Access Phase (Phase-Only, Zero Extension Awareness)
    {
        // Sub-test A: Blocked IP -> Deny 403
        AuroraAccessInput in_blocked = {
            .client_ip = (const uint8_t *)"192.168.1.50",
            .client_ip_len = 12,
            .host = (const uint8_t *)"example.com",
            .host_len = 11,
            .path = (const uint8_t *)"/admin/users",
            .path_len = 12,
            .method = (const uint8_t *)"GET",
            .method_len = 3,
            .query = NULL,
            .query_len = 0,
            .content_length = 0,
            .header_length = 0,
            .random_seed = 42,
            .now_ms = 1000,
        };
        AuroraAccessOutcome outcome_blocked;
        assert(aurora_gateway_phase_access(&in_blocked, NULL, NULL, smoke_alloc, &outcome_blocked) == 0);
        assert(outcome_blocked.action == AURORA_ACTION_DENY);
        assert(outcome_blocked.status_code == 403);

        // Sub-test B: Allowed IP -> Allow 200
        AuroraAccessInput in_allowed = {
            .client_ip = (const uint8_t *)"10.0.0.1",
            .client_ip_len = 8,
            .host = (const uint8_t *)"example.com",
            .host_len = 11,
            .path = (const uint8_t *)"/admin/users",
            .path_len = 12,
            .method = (const uint8_t *)"GET",
            .method_len = 3,
            .query = NULL,
            .query_len = 0,
            .content_length = 0,
            .header_length = 0,
            .random_seed = 42,
            .now_ms = 1000,
        };
        AuroraAccessOutcome outcome_allowed;
        assert(aurora_gateway_phase_access(&in_allowed, NULL, NULL, smoke_alloc, &outcome_allowed) == 0);
        assert(outcome_allowed.action == AURORA_ACTION_ALLOW);
        assert(outcome_allowed.status_code == 200);

        puts("Phase 1 Access: route trie evaluation, deny 403, allow 200 pass");
    }

    // 5. Gateway Phase 2: HTTP Content Phase (/metrics, /healthz)
    {
        uint8_t raw_body[4096];
        AuroraContentOutcome cout;
        memset(&cout, 0, sizeof(cout));
        cout.body = raw_body;
        cout.body_cap = sizeof(raw_body);

        // Test /metrics
        AuroraContentInput cin_metrics = {
            .host = (const uint8_t *)"localhost",
            .host_len = 9,
            .path = (const uint8_t *)"/metrics",
            .path_len = 8,
            .method = (const uint8_t *)"GET",
            .method_len = 3,
            .query = NULL,
            .query_len = 0,
        };
        assert(aurora_gateway_phase_content(&cin_metrics, &cout) == 0);
        assert(cout.status_code == 200);
        assert(cout.body_len > 0);
        assert(strstr((const char *)cout.content_type, "text/plain") != NULL);

        // Test /healthz
        memset(&cout, 0, sizeof(cout));
        cout.body = raw_body;
        cout.body_cap = sizeof(raw_body);
        AuroraContentInput cin_healthz = {
            .host = (const uint8_t *)"localhost",
            .host_len = 9,
            .path = (const uint8_t *)"/healthz",
            .path_len = 8,
            .method = (const uint8_t *)"GET",
            .method_len = 3,
            .query = NULL,
            .query_len = 0,
        };
        assert(aurora_gateway_phase_content(&cin_healthz, &cout) == 0);
        assert(cout.status_code == 200);
        assert(strstr((const char *)cout.content_type, "application/json") != NULL);
        assert(strstr((const char *)raw_body, "UP") != NULL);

        puts("Phase 2 Content: /metrics and /healthz render pass");
    }

    // 6. Gateway Phase 3: HTTP Header Filter Phase
    {
        AuroraHeaderFilterInput hf_in = {
            .upstream_status = 200,
            .is_websocket = 0,
        };
        AuroraHeaderFilterOutcome hf_out;
        assert(aurora_gateway_phase_header_filter(&hf_in, &hf_out) == 0);
        assert(hf_out.action == AURORA_FILTER_PASSTHROUGH);
        puts("Phase 3 Header Filter: passthrough pass");
    }

    // 7. Gateway Phase 4: HTTP Body Filter Phase
    {
        const char *test_chunk = "hello world payload";
        AuroraBodyFilterInput bf_in = {
            .chunk = (const uint8_t *)test_chunk,
            .chunk_len = strlen(test_chunk),
            .is_last = 1,
        };
        AuroraBodyFilterOutcome bf_out;
        assert(aurora_gateway_phase_body_filter(&bf_in, &bf_out) == 0);
        assert(bf_out.action == AURORA_BODY_FILTER_PASSTHROUGH);
        puts("Phase 4 Body Filter: streaming passthrough pass");
    }

    // 8. Gateway Phase 5: HTTP Log Phase Submission
    {
        AuroraLogInput log_test;
        memset(&log_test, 0, sizeof(log_test));
        log_test.client_ip = (const uint8_t *)"192.168.1.100";
        log_test.client_ip_len = 13;
        log_test.method = (const uint8_t *)"GET";
        log_test.method_len = 3;
        log_test.uri = (const uint8_t *)"/test/background";
        log_test.uri_len = 16;
        log_test.status = 200;
        log_test.duration_ms = 12;
        log_test.bytes_sent = 1024;
        log_test.bytes_recv = 128;
        assert(aurora_gateway_phase_log(&log_test) == 0);
        puts("Phase 5 Log: 1-FFI non-blocking submit pass");
    }

    // 9. Live In-Flight Request Gauges & Content Phase Prometheus Integration
    {
        assert(aurora_gateway_in_flight_count() == 0);
        aurora_gateway_in_flight_enter();
        assert(aurora_gateway_in_flight_count() == 1);
        aurora_gateway_in_flight_enter();
        assert(aurora_gateway_in_flight_count() == 2);
        aurora_gateway_in_flight_leave();
        assert(aurora_gateway_in_flight_count() == 1);

        uint8_t prom_buf[2048];
        AuroraContentOutcome prom_out;
        memset(&prom_out, 0, sizeof(prom_out));
        prom_out.body = prom_buf;
        prom_out.body_cap = sizeof(prom_buf);
        AuroraContentInput prom_in = {
            .host = NULL,
            .host_len = 0,
            .path = (const uint8_t *)"/metrics",
            .path_len = 8,
            .method = (const uint8_t *)"GET",
            .method_len = 3,
            .query = NULL,
            .query_len = 0,
        };
        assert(aurora_gateway_phase_content(&prom_in, &prom_out) == 0);
        assert(prom_out.body_len > 0);
        assert(strstr((const char *)prom_buf, "gateway_requests_in_flight 1") != NULL);
        aurora_gateway_in_flight_leave();
        assert(aurora_gateway_in_flight_count() == 0);
        puts("Live In-Flight Gauges & Prometheus render pass");
    }

    // 10. Process Shutdown
    aurora_gateway_process_exit();
    puts("Gateway Process Exit: clean shutdown pass");

    puts("C -> Rust Pure Phase-Driven FFI ABI v4: all checks passed cleanly!");
    return 0;
}
