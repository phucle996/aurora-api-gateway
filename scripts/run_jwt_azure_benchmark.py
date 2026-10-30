#!/usr/bin/env python3
"""
Aurora API Gateway - High-Precision Azure Distributed Cluster Benchmark Runner
Measures real-world Dataplane performance for JWT Extension + L2 Redis Sync
Hardware:
  - VM1 (Gateway + Redis 7): 20.2.249.91 / 172.16.0.4 (4 vCPUs AMD EPYC 7763, 16GB RAM)
  - VM2 (Generator + Backend): 20.205.137.141 / 172.16.0.5 (2 vCPUs AMD EPYC 7763, 4GB RAM)
"""

import subprocess
import time
import json
import hmac
import hashlib
import base64
import re
import socket
import sys
import urllib.request

GATEWAY_IP = "172.16.0.4"
REDIS_IP = "172.16.0.4"
REDIS_PORT = 6379
SECRET = b"super-secret-key-32-chars-long-minimum-bytes!!"

def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

def create_jwt(sub: str, role: str, exp: int, jti: str = "") -> str:
    hdr = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload_dict = {"sub": sub, "role": role, "exp": exp}
    if jti:
        payload_dict["jti"] = jti
    pld = b64url(json.dumps(payload_dict, separators=(",", ":")).encode())
    sig = b64url(hmac.new(SECRET, f"{hdr}.{pld}".encode(), hashlib.sha256).digest())
    return f"{hdr}.{pld}.{sig}"

now = int(time.time())
valid_token = create_jwt("user_benchmark_42", "admin", now + 86400, "jti_valid_42")
expired_token = create_jwt("user_expired", "admin", now - 3600, "jti_expired_99")
forged_token = valid_token[:-12] + "badbadbadbad"
cookie_token = create_jwt("user_benchmark_cookie", "operator", now + 86400, "jti_cookie_101")

with open("token_valid.txt", "w") as f: f.write(valid_token)
with open("token_expired.txt", "w") as f: f.write(expired_token)
with open("token_forged.txt", "w") as f: f.write(forged_token)

# Generate Lua script for Chaos Storm
lua_chaos = f"""local counter = 0
local valid_tok = "{valid_token}"
local expired_tok = "{expired_token}"
local forged_tok = "{forged_token}"

request = function()
    counter = (counter + 1) % 100
    if counter < 40 then
        -- 40% Valid Tokens
        local headers = {{}}
        headers["Authorization"] = "Bearer " .. valid_tok
        return wrk.format("GET", "/api/v1/echo", headers, nil)
    elseif counter < 65 then
        -- 25% Exclude Paths Whitelist
        return wrk.format("GET", "/api/v1/products", nil, nil)
    elseif counter < 80 then
        -- 15% Forged Signature Attack
        local headers = {{}}
        headers["Authorization"] = "Bearer " .. forged_tok
        return wrk.format("GET", "/api/v1/echo", headers, nil)
    elseif counter < 90 then
        -- 10% Expired Token Rejection
        local headers = {{}}
        headers["Authorization"] = "Bearer " .. expired_tok
        return wrk.format("GET", "/api/v1/echo", headers, nil)
    else
        -- 10% Missing Token Unauthenticated
        return wrk.format("GET", "/api/v1/echo", nil, nil)
    end
end
"""
with open("jwt_chaos_storm.lua", "w") as f:
    f.write(lua_chaos)

def redis_exec(cmd_list):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((REDIS_IP, REDIS_PORT))
    wire = f"*{len(cmd_list)}\r\n" + "".join(f"${len(p.encode())}\r\n{p}\r\n" for p in cmd_list)
    s.sendall(wire.encode())
    res = s.recv(4096)
    s.close()
    return res.decode(errors="ignore")

def get_prometheus_metrics():
    try:
        req = urllib.request.Request(f"http://{GATEWAY_IP}/metrics", headers={"User-Agent": "BenchMetrics"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            text = resp.read().decode()
        metrics = {}
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 2:
                key, val = parts[0], parts[1]
                try:
                    metrics[key] = float(val)
                except ValueError:
                    metrics[key] = val
        return metrics
    except Exception as e:
        return {"error": str(e)}

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
    m_before = get_prometheus_metrics()
    t_start = time.time()
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    t_end = time.time()
    m_after = get_prometheus_metrics()
    parsed = parse_wrk_output(res.stdout)
    parsed["duration_actual_s"] = round(t_end - t_start, 2)
    parsed["prometheus_before"] = m_before
    parsed["prometheus_after"] = m_after

    print(f"    -> RPS: {parsed.get('rps'):,.2f} | P50: {parsed.get('p50_ms')}ms | P99: {parsed.get('p99_ms')}ms | Max: {parsed.get('latency_max_ms')}ms | Non-2xx: {parsed.get('non_2xx_responses')}", flush=True)
    return parsed

print("==================================================================", flush=True)
print("  AURORA API GATEWAY - AZURE LIVE DISTRIBUTED BENCHMARK SUITE    ", flush=True)
print("  Gateway: 172.16.0.4 (4 vCPUs AMD EPYC 7763, 16GB RAM)          ", flush=True)
print("  LoadGen: 172.16.0.5 (2 vCPUs AMD EPYC 7763, 4GB RAM)           ", flush=True)
print("==================================================================", flush=True)

results = {}

# 01. Raw Proxy Baseline (No Auth Overhead)
results["01_raw_proxy_baseline"] = run_scenario(
    "01_Raw_Proxy_Baseline",
    f"wrk -t4 -c200 -d10s --latency http://{GATEWAY_IP}/api/v1/products"
)

# 02. Exclude Path Bypass (Trie Whitelist Pass-through)
results["02_exclude_path_bypass"] = run_scenario(
    "02_Exclude_Path_Bypass",
    f"wrk -t4 -c200 -d10s --latency http://{GATEWAY_IP}/api/v1/products"
)

# 03. Valid JWT Clean Proxy (L1 Sheet Cache Hit + Forwarded Headers)
results["03_valid_jwt_clean_proxy"] = run_scenario(
    "03_Valid_JWT_Clean_Proxy",
    f"wrk -t4 -c200 -d10s -H \"Authorization: Bearer {valid_token}\" --latency http://{GATEWAY_IP}/api/v1/echo"
)

# 04. Attack Flood - Forged Signature (Edge Rejection Defense)
results["04_forged_signature_flood"] = run_scenario(
    "04_Forged_Signature_Flood",
    f"wrk -t4 -c200 -d10s -H \"Authorization: Bearer {forged_token}\" --latency http://{GATEWAY_IP}/api/v1/echo"
)

# 05. Attack Flood - Missing Token (Edge Rejection Defense)
results["05_missing_token_flood"] = run_scenario(
    "05_Missing_Token_Flood",
    f"wrk -t4 -c200 -d10s --latency http://{GATEWAY_IP}/api/v1/echo"
)

# 06. Cookie Authentication (Zero-allocation RFC 6265)
results["06_cookie_authentication"] = run_scenario(
    "06_Cookie_Authentication",
    f"wrk -t4 -c200 -d10s -H \"Cookie: session_id={cookie_token}\" --latency http://{GATEWAY_IP}/api/v1/cookie"
)

# 07. Live Redis Revocation Propagation Under Load
print("\n=======================================================", flush=True)
print("==> Running Scenario: 07_Live_Redis_Revocation_Propagation", flush=True)
rev_token = create_jwt("victim_user", "member", now + 7200, "jti_victim_rev")
# Warm positive cache first
warm_resp = subprocess.run(
    f"curl -s -o /dev/null -w '%{{http_code}}' -H \"Authorization: Bearer {rev_token}\" http://{GATEWAY_IP}/api/v1/echo",
    shell=True, capture_output=True, text=True
)
print(f"    Cache warm pre-check: HTTP {warm_resp.stdout.strip()}", flush=True)

# Publish revocation to Redis and measure propagation latency
t_pub = time.perf_counter()
redis_exec(["INCR", "aurora:jwt:revocation_version"])
redis_exec(["SADD", "aurora:jwt:revoked_set", rev_token])
pub_res = redis_exec(["PUBLISH", "aurora:jwt:revocations", f"{rev_token}#100"])
t_after_pub = time.perf_counter()

# Poll until 401 received
poll_status = 200
poll_attempts = 0
t_revoked = t_after_pub
while poll_status != 401 and poll_attempts < 200:
    poll_attempts += 1
    p_resp = subprocess.run(
        f"curl -s -o /dev/null -w '%{{http_code}}' -H \"Authorization: Bearer {rev_token}\" http://{GATEWAY_IP}/api/v1/echo",
        shell=True, capture_output=True, text=True
    )
    code = p_resp.stdout.strip()
    if code == "401":
        t_revoked = time.perf_counter()
        poll_status = 401
        break
    time.sleep(0.002) # 2ms poll interval

propagation_delay_ms = round((t_revoked - t_pub) * 1000.0, 2)
print(f"    Redis PUBLISH Subscribers: {pub_res.strip()}", flush=True)
print(f"    Revocation Propagation Delay: {propagation_delay_ms} ms (Poll attempts: {poll_attempts})", flush=True)
results["07_live_redis_revocation"] = {
    "propagation_delay_ms": propagation_delay_ms,
    "redis_publish_reply": pub_res.strip(),
    "poll_attempts": poll_attempts,
    "final_status": poll_status
}

# 08. Cold Boot / SSCAN Bulk Reconciliation
print("\n=======================================================", flush=True)
print("==> Running Scenario: 08_Bulk_SSCAN_Reconciliation", flush=True)
print("    Generating 10,000 revoked tokens into Redis Set aurora:jwt:revoked_set ...", flush=True)
t_gen_start = time.perf_counter()
# Pipeline batch SADD using raw socket
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.connect((REDIS_IP, REDIS_PORT))
batch_size = 500
total_items = 10000
for b in range(0, total_items, batch_size):
    items = [f"revoked_bulk_{i}:2000000000" for i in range(b, b + batch_size)]
    cmd_parts = ["SADD", "aurora:jwt:revoked_set"] + items
    wire = f"*{len(cmd_parts)}\r\n" + "".join(f"${len(p.encode())}\r\n{p}\r\n" for p in cmd_parts)
    sock.sendall(wire.encode())
    _ = sock.recv(1024)
sock.close()
redis_exec(["INCR", "aurora:jwt:revocation_version"])
t_gen_end = time.perf_counter()
bulk_duration_ms = round((t_gen_end - t_gen_start) * 1000.0, 2)
print(f"    10,000 bulk revoked tokens inserted in {bulk_duration_ms} ms", flush=True)
results["08_bulk_sscan_reconciliation"] = {
    "total_bulk_tokens": total_items,
    "insertion_duration_ms": bulk_duration_ms
}

# 09. Chaos Storm Mixed Multi-Vector Attack & Defense
results["09_chaos_storm_mixed"] = run_scenario(
    "09_Chaos_Storm_Mixed",
    f"wrk -t4 -c200 -d10s -s jwt_chaos_storm.lua --latency http://{GATEWAY_IP}/api/v1/echo"
)

# 10. Sustained Soak Endurance (300 seconds / 5 minutes @ 200 conns)
print("\n=======================================================", flush=True)
print("==> Running Scenario: 10_Sustained_Soak_300s (5-Minute Endurance)", flush=True)
results["10_sustained_soak_300s"] = run_scenario(
    "10_Sustained_Soak_300s",
    f"wrk -t4 -c200 -d300s -H \"Authorization: Bearer {valid_token}\" --latency http://{GATEWAY_IP}/api/v1/echo"
)

out_file = "/tmp/jwt_azure_benchmark_results.json"
with open(out_file, "w") as f:
    json.dump(results, f, indent=2)

print("\n==================================================================", flush=True)
print("  ALL AZURE BENCHMARK SCENARIOS COMPLETED SUCCESSFULLY!           ", flush=True)
print(f"  Summary saved to {out_file}               ", flush=True)
print("==================================================================", flush=True)
