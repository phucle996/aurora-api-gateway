#!/usr/bin/env python3
"""
Aurora API Gateway - High-Precision Azure Distributed Cluster Benchmark Runner
Measures real-world Dataplane performance for Blue-Green Deployment Extension:
  - SWAR 64-bit integer bitmask slot resolution
  - Branchless arithmetic candidate slot selection
  - Preview security guard (64-bit FNV-1a secret hash + CIDR bitwise subnet check)
  - Head-to-head comparison with NGINX Native `map` and Raw NGINX Baseline.

Hardware Topology:
  - VM1 (Gateway Core): 20.2.249.91 / 172.16.0.4 (4 vCPUs AMD EPYC 7763, 16GB RAM)
  - VM2 (LoadGen + Backend): 20.205.137.141 / 172.16.0.5 (2 vCPUs AMD EPYC 7763, 4GB RAM)
"""

import subprocess
import time
import json
import re
import sys
import urllib.request

GATEWAY_IP = "172.16.0.4"
SECRET = "stage-secret-2026"

def parse_wrk_output(output):
    data = {}
    m_rps = re.search(r"Requests/sec:\s+([\d\.]+)", output)
    data["rps"] = float(m_rps.group(1)) if m_rps else 0.0

    m_bw = re.search(r"Transfer/sec:\s+([\d\.]+)(\w+)", output)
    if m_bw:
        val, unit = float(m_bw.group(1)), m_bw.group(2)
        if "KB" in unit: val = val / 1024.0
        data["bandwidth_mb_s"] = round(val, 2)
    else:
        data["bandwidth_mb_s"] = 0.0

    m_lat = re.search(r"Latency\s+([\d\.]+)(\w+)\s+([\d\.]+)(\w+)\s+([\d\.]+)(\w+)", output)
    if m_lat:
        def to_ms(v, u):
            v = float(v)
            if u == "us": return v / 1000.0
            if u == "s": return v * 1000.0
            return v
        data["latency_mean_ms"] = round(to_ms(m_lat.group(1), m_lat.group(2)), 2)
        data["latency_max_ms"] = round(to_ms(m_lat.group(5), m_lat.group(6)), 2)

    def extract_dist(pct_str):
        m = re.search(rf"{pct_str}\s+([\d\.]+)(\w+)", output)
        if m:
            v, u = float(m.group(1)), m.group(2)
            if u == "us": return round(v / 1000.0, 2)
            if u == "s": return round(v * 1000.0, 2)
            return round(v, 2)
        return 0.0

    data["p50_ms"] = extract_dist("50%")
    data["p75_ms"] = extract_dist("75%")
    data["p90_ms"] = extract_dist("90%")
    data["p99_ms"] = extract_dist("99%")

    m_req = re.search(r"(\d+)\s+requests in\s+([\d\.]+)s", output)
    if m_req:
        data["total_requests"] = int(m_req.group(1))
        data["duration_s"] = float(m_req.group(2))

    m_err = re.search(r"Non-2xx or 3xx responses:\s+(\d+)", output)
    data["non_2xx_responses"] = int(m_err.group(1)) if m_err else 0
    data["raw_output"] = output
    return data

def run_scenario(name, cmd):
    print(f"\n=======================================================", flush=True)
    print(f"==> Running Scenario: {name}", flush=True)
    print(f"    Command: {cmd}", flush=True)
    t_start = time.time()
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    t_end = time.time()
    parsed = parse_wrk_output(res.stdout)
    parsed["duration_actual_s"] = round(t_end - t_start, 2)

    print(f"    -> RPS: {parsed.get('rps'):,.2f} | P50: {parsed.get('p50_ms')}ms | P99: {parsed.get('p99_ms')}ms | Max: {parsed.get('latency_max_ms')}ms | Non-2xx: {parsed.get('non_2xx_responses')}", flush=True)
    return parsed

print("==================================================================", flush=True)
print("  AURORA API GATEWAY - BLUE-GREEN AZURE CLUSTER BENCHMARK SUITE   ", flush=True)
print("  Gateway VM1: 172.16.0.4 (4 vCPUs AMD EPYC 7763, 16GB RAM)       ", flush=True)
print("  LoadGen VM2: 172.16.0.5 (2 vCPUs AMD EPYC 7763, 4GB RAM)        ", flush=True)
print("==================================================================", flush=True)

results = {}

# 01. Raw NGINX Baseline (Port 8088, Direct Proxy to Upstream)
results["01_raw_nginx_baseline"] = run_scenario(
    "01_Raw_NGINX_Baseline_Port8088",
    f"wrk -t4 -c200 -d10s --latency http://{GATEWAY_IP}:8088/api/v1/ping"
)

# 02. NGINX Native map Baseline (Port 8089, Default Slot)
results["02_nginx_native_map_default"] = run_scenario(
    "02_NGINX_Native_Map_Default_Port8089",
    f"wrk -t4 -c200 -d10s --latency http://{GATEWAY_IP}:8089/api/v1/ping"
)

# 03. NGINX Native map Header Override (Port 8089, X-Deploy-Slot: green)
results["03_nginx_native_map_override"] = run_scenario(
    "03_NGINX_Native_Map_Override_Port8089",
    f"wrk -t4 -c200 -d10s -H \"X-Deploy-Slot: green\" --latency http://{GATEWAY_IP}:8089/api/v1/ping"
)

# 04. Aurora API Gateway (Port 80) — Active Slot Blue Routing
results["04_aurora_blue_active_slot"] = run_scenario(
    "04_Aurora_Blue_Active_Slot_Port80",
    f"wrk -t4 -c200 -d10s --latency http://{GATEWAY_IP}/api/v1/ping"
)

# 05. Aurora API Gateway (Port 80) — SWAR Header Override + Valid Secret Guard
results["05_aurora_green_authorized_override"] = run_scenario(
    "05_Aurora_Green_Authorized_Override_Port80",
    f"wrk -t4 -c200 -d10s -H \"X-Deploy-Slot: green\" -H \"X-Preview-Secret: {SECRET}\" --latency http://{GATEWAY_IP}/api/v1/ping"
)

# 06. Aurora API Gateway (Port 80) — Unauthorized Forged Override Blocked (Safe Fallback to Blue)
results["06_aurora_forged_override_blocked"] = run_scenario(
    "06_Aurora_Forged_Override_Blocked_Port80",
    f"wrk -t4 -c200 -d10s -H \"X-Deploy-Slot: green\" --latency http://{GATEWAY_IP}/api/v1/ping"
)

# Write results
output_file = "blue_green_azure_benchmark_results.json"
with open(output_file, "w") as f:
    json.dump(results, f, indent=2)

print("\n==================================================================", flush=True)
print(f"  BENCHMARK COMPLETE - Results saved to {output_file}", flush=True)
print("==================================================================", flush=True)
baseline_rps = results["01_raw_nginx_baseline"]["rps"]
for key, r in results.items():
    rps = r["rps"]
    overhead = ((rps - baseline_rps) / baseline_rps) * 100.0 if baseline_rps > 0 else 0.0
    print(f"  * {key:<40}: {rps:>10,.2f} RPS (P50: {r.get('p50_ms'):>5.2f}ms) [{overhead:>+6.2f}% vs Raw]", flush=True)
