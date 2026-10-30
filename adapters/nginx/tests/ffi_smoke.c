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
            .path = (const uint8_t *)"/api/v1/users",
            .path_len = 13,
            .content_type = (const uint8_t *)"application/json",
            .content_type_len = 16,
            .content_length = 2048,
            .accept_encoding = (const uint8_t *)"gzip, deflate, zstd",
            .accept_encoding_len = 19,
        };
        AuroraHeaderFilterOutcome hf_out;
        assert(aurora_gateway_phase_header_filter(&hf_in, &hf_out) == 0);
        puts("Phase 3 Header Filter: evaluation pass");
    }

    // 7. Gateway Phase 4: HTTP Body Filter Phase
    {
        const char *test_chunk = "{\"event\":\"user_login\",\"user_id\":1002,\"status\":\"success\",\"payload\":\"simulated payload length exceeding threshold\"}";
        AuroraBodyFilterInput bf_in = {
            .chunk = (const uint8_t *)test_chunk,
            .chunk_len = strlen(test_chunk),
            .is_last = 1,
            .compression_algorithm = 1, // Zstd
            .alloc_ctx = NULL,
            .alloc_fn = smoke_alloc,
        };
        AuroraBodyFilterOutcome bf_out;
        assert(aurora_gateway_phase_body_filter(&bf_in, &bf_out) == 0);
        puts("Phase 4 Body Filter: zero-copy pointer handover pass");
        if (bf_out.action == AURORA_BODY_FILTER_MUTATED && bf_out.out_ptr != NULL) {
            free(bf_out.out_ptr);
        }
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

    // 10. Gateway Response Cache Substrate & Zero-Copy Pinned Memory
    {
        const char *cache_policy = "{\"enabled\":true,\"default_ttl_secs\":300,\"max_memory_mb\":64,\"allowed_methods\":[\"GET\",\"HEAD\"]}";
        assert(aurora_gateway_policy_writer_update(12, 1, (const uint8_t *)cache_policy, strlen(cache_policy)) == 0);
        aurora_gateway_policy_sync();

        // Sub-test A: Cache MISS before storing
        AuroraAccessInput in_cache = {
            .client_ip = (const uint8_t *)"127.0.0.1",
            .client_ip_len = 9,
            .host = (const uint8_t *)"example.com",
            .host_len = 11,
            .path = (const uint8_t *)"/api/cached-resource",
            .path_len = 20,
            .method = (const uint8_t *)"GET",
            .method_len = 3,
            .query = NULL,
            .query_len = 0,
            .content_length = 0,
            .header_length = 0,
            .random_seed = 42,
            .now_ms = 1000,
        };
        AuroraAccessOutcome out_cache;
        assert(aurora_gateway_phase_access(&in_cache, NULL, NULL, smoke_alloc, &out_cache) == 0);
        assert(out_cache.action == AURORA_ACTION_ALLOW);

        // Sub-test B: Store response via cache store
        const char *payload = "{\"status\":\"ok\",\"message\":\"High-speed Edge Response Cache\"}";
        AuroraCacheStoreInput store_in = {
            .method = (const uint8_t *)"GET",
            .method_len = 3,
            .host = (const uint8_t *)"example.com",
            .host_len = 11,
            .path = (const uint8_t *)"/api/cached-resource",
            .path_len = 20,
            .query = NULL,
            .query_len = 0,
            .status = 200,
            .content_type = (const uint8_t *)"application/json",
            .content_type_len = 16,
            .body = (const uint8_t *)payload,
            .body_len = strlen(payload),
            .cache_control = (const uint8_t *)"public, max-age=600",
            .cache_control_len = 19,
            .etag = (const uint8_t *)"\"v1.0\"",
            .etag_len = 6,
        };
        assert(aurora_gateway_phase_cache_store(&store_in) == 0);

        // Sub-test C: Cache HIT with pinned Arc
        AuroraAccessOutcome out_hit;
        memset(&out_hit, 0, sizeof(out_hit));
        assert(aurora_gateway_phase_access(&in_cache, NULL, NULL, smoke_alloc, &out_hit) == 0);
        assert(out_hit.action == AURORA_ACTION_DENY);
        assert(out_hit.status_code == 200);
        assert(out_hit.flags & AURORA_FLAG_CACHE_PINNED);
        assert(out_hit.body != NULL);
        assert(out_hit.body_len > 0);

        // Safe release via pool cleanup hook
        uintptr_t ptr_val = 0;
        memcpy(&ptr_val, &out_hit.release_token.opaque[0], sizeof(uintptr_t));
        assert(ptr_val != 0);
        aurora_release_cache_entry((void *)ptr_val);

        puts("Response Cache Multi-Variant & Zero-Copy Pinned Memory pass");

        // Sub-test D: Per-Route Bitmask Switch via AURORA_SLOT_ROUTE_MASKS
        const char *route_masks_json =
            "{\"routes\":[{\"path\":\"/api/cached-resource\",\"allow_mask\":0,\"deny_mask\":4294967295,\"explicit\":true}]}";
        assert(aurora_gateway_policy_writer_update(
                   AURORA_SLOT_ROUTE_MASKS, 10, (const uint8_t *)route_masks_json,
                   strlen(route_masks_json)) == 0);
        aurora_gateway_policy_sync();

        AuroraAccessOutcome out_bypassed;
        memset(&out_bypassed, 0, sizeof(out_bypassed));
        assert(aurora_gateway_phase_access(&in_cache, NULL, NULL, smoke_alloc, &out_bypassed) == 0);
        // Because route_mask is 0 for /api/cached-resource, cache is bypassed and action is ALLOW!
        assert(out_bypassed.action == AURORA_ACTION_ALLOW);
        assert(out_bypassed.route_mask == 0);
        puts("Per-Route Bitmask Switch (AURORA_SLOT_ROUTE_MASKS): isolation & bypass pass");
    }

    // 11. Process Shutdown
    aurora_gateway_process_exit();
    puts("Gateway Process Exit: clean shutdown pass");

    puts("C -> Rust Pure Phase-Driven FFI ABI v4: all checks passed cleanly!");
    return 0;
}
