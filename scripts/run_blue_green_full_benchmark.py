#!/usr/bin/env python3
"""
Aurora API Gateway - High-Precision Azure Distributed Cluster Benchmark Runner
Blue-Green Deployment Extension Multi-Scenario Empirical Benchmark Suite:
  - Hardware:
      * VM1 (Gateway Node): 172.16.0.4 (4 vCPUs AMD EPYC 7763, 16GB RAM)
      * VM2 (LoadGen & Backend): 172.16.0.5 (2 vCPUs AMD EPYC 7763, 4GB RAM)
  - 3 Core Scenarios:
      * KB 01: Raw Proxy Baseline across all tested proxies (Zero Plugins)
      * KB 02: Active Slot & Dynamic Slot Routing (Plugins Enabled)
      * KB 03: Chaos Storm & Edge Security Defense (Mixed Traffic + Attack Rejection)
"""

import subprocess
import time
import json
import re
import os
import sys

VM1_IP = "20.2.249.91"
VM1_INTERNAL = "172.16.0.4"
VM2_IP = "20.205.137.141"
VM2_INTERNAL = "172.16.0.5"
SECRET = "stage-secret-2026"

def run_ssh(host, cmd, timeout=30):
    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", f"phucle@{host}", cmd]
    res = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=timeout)
    return res.stdout.strip()

def parse_wrk(output):
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
        data["latency_stdev_ms"] = round(to_ms(m_lat.group(3), m_lat.group(4)), 2)
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
    return data

def parse_mpstat(output):
    data = {"cores": {}}
    lines = output.splitlines()
    reading_avg = False
    for line in lines:
        if "Average:" in line:
            reading_avg = True
            parts = line.split()
            if len(parts) >= 12 and parts[1] != "CPU":
                cpu_id = parts[1]
                usr = float(parts[2])
                sys_pct = float(parts[4])
                soft = float(parts[7])
                idle = float(parts[11])
                total = round(100.0 - idle, 2)
                if cpu_id == "all":
                    data["cpu_total"] = total
                    data["cpu_usr"] = usr
                    data["cpu_sys"] = sys_pct
                    data["cpu_soft"] = soft
                    data["cpu_idle"] = idle
                elif cpu_id.isdigit():
                    data["cores"][f"core_{cpu_id}"] = {
                        "total": total,
                        "usr": usr,
                        "sys": sys_pct,
                        "soft": soft,
                        "idle": idle
                    }
    return data

def parse_pidstat(output, proc_name):
    rss_peak = 0.0
    cswch = 0.0
    for line in output.splitlines():
        if proc_name in line:
            parts = line.split()
            # Check RSS section
            if len(parts) >= 9 and parts[7].isdigit():
                rss_kb = float(parts[7])
                rss_mb = round(rss_kb / 1024.0, 2)
                if rss_mb > rss_peak: rss_peak = rss_mb
            # Check cswch section
            if len(parts) >= 6 and re.match(r"^\d+\.\d+$", parts[3]):
                cswch += float(parts[3])
    return {"peak_rss_mb": rss_peak, "cswch_per_s": round(cswch, 1)}

def run_benchmark_step(name, target_port, extra_args="", lua_script="", proc_name="aurora-gateway", duration=10):
    print(f"\n=======================================================", flush=True)
    print(f"[*] Starting Step: {name} (Port: {target_port})", flush=True)

    # 1. Start mpstat & pidstat in background on VM1
    run_ssh(VM1_IP, "rm -f /tmp/mpstat.out /tmp/pidstat.out")
    run_ssh(VM1_IP, f"nohup mpstat -P ALL 1 {duration} > /tmp/mpstat.out 2>&1 & disown")
    run_ssh(VM1_IP, f"nohup pidstat -w -r 1 {duration} > /tmp/pidstat.out 2>&1 & disown")

    time.sleep(1.0)

    # 2. Run wrk on VM2
    lua_arg = f"-s {lua_script}" if lua_script else ""
    wrk_cmd = f"wrk -t4 -c200 -d{duration}s {extra_args} {lua_arg} --latency http://{VM1_INTERNAL}:{target_port}/api/v1/ping"
    print(f"    Running: {wrk_cmd}", flush=True)
    wrk_out = run_ssh(VM2_IP, wrk_cmd, timeout=duration + 15)
    wrk_data = parse_wrk(wrk_out)

    time.sleep(1.0)

    # 3. Collect mpstat and pidstat from VM1
    mpstat_out = run_ssh(VM1_IP, "cat /tmp/mpstat.out")
    mpstat_data = parse_mpstat(mpstat_out)

    pidstat_out = run_ssh(VM1_IP, "cat /tmp/pidstat.out")
    pidstat_data = parse_pidstat(pidstat_out, proc_name)

    # Combine
    result = {
        "step_name": name,
        "target_port": target_port,
        "wrk": wrk_data,
        "cpu": mpstat_data,
        "process": pidstat_data
    }

    rps = wrk_data.get("rps", 0.0)
    p50 = wrk_data.get("p50_ms", 0.0)
    p99 = wrk_data.get("p99_ms", 0.0)
    cpu_tot = mpstat_data.get("cpu_total", 0.0)
    print(f"    [+] Result: {rps:,.2f} RPS | P50: {p50}ms | P99: {p99}ms | CPU: {cpu_tot}%", flush=True)
    return result

def main():
    print("==================================================================", flush=True)
    print("  AURORA API GATEWAY - FULL BLUE-GREEN BENCHMARK EXECUTION SUITE  ", flush=True)
    print("==================================================================", flush=True)

    # Setup chaos lua script on VM2
    chaos_lua = f"""local counter = 0
request = function()
    counter = (counter + 1) % 100
    if counter < 40 then
        -- 40% Standard default traffic (Blue)
        return wrk.format("GET", "/api/v1/ping", nil, nil)
    elseif counter < 60 then
        -- 20% Legitimate Green Preview (Header + Valid Secret)
        local headers = {{}}
        headers["X-Deploy-Slot"] = "green"
        headers["X-Preview-Secret"] = "{SECRET}"
        return wrk.format("GET", "/api/v1/ping", headers, nil)
    elseif counter < 80 then
        -- 20% Forged/Unauthorized Green Override Attempt (Sanitized/Blocked back to Blue)
        local headers = {{}}
        headers["X-Deploy-Slot"] = "green"
        headers["X-Preview-Secret"] = "attacker-unauthorized-guess"
        return wrk.format("GET", "/api/v1/ping", headers, nil)
    else
        -- 20% Cookie Fallback Override (Valid Cookie Preview)
        local headers = {{}}
        headers["Cookie"] = "deploy_slot=green; preview_secret={SECRET}"
        return wrk.format("GET", "/api/v1/ping", headers, nil)
    end
end
"""
    run_ssh(VM2_IP, f"cat << 'EOF' > /tmp/bg_chaos.lua\n{chaos_lua}\nEOF")

    all_results = {}

    # ==========================================
    # KB 01: RAW PROXY BASELINES (ZERO PLUGINS)
    # ==========================================
    print("\n>>> EXECUTING KB 01: RAW PROXY BASELINES <<<", flush=True)
    all_results["kb01_raw_nginx"] = run_benchmark_step(
        "KB01_Raw_NGINX_Port8088", 8088, proc_name="aurora-gateway"
    )
    all_results["kb01_raw_aurora"] = run_benchmark_step(
        "KB01_Raw_Aurora_Port80", 80, proc_name="aurora-gateway"
    )
    all_results["kb01_raw_envoy"] = run_benchmark_step(
        "KB01_Raw_Envoy_Port8090", 8090, proc_name="envoy"
    )
    all_results["kb01_raw_kong"] = run_benchmark_step(
        "KB01_Raw_Kong_Port8000", 8000, proc_name="nginx"
    )

    # ==========================================
    # KB 02: ACTIVE & DYNAMIC SLOT ROUTING (PLUGINS ENABLED)
    # ==========================================
    print("\n>>> EXECUTING KB 02: ACTIVE & DYNAMIC SLOT ROUTING <<<", flush=True)
    all_results["kb02_nginx_map_default"] = run_benchmark_step(
        "KB02_NGINX_Map_Default_Port8089", 8089, proc_name="aurora-gateway"
    )
    all_results["kb02_nginx_map_override"] = run_benchmark_step(
        "KB02_NGINX_Map_OverrideGreen_Port8089", 8089, extra_args='-H "X-Deploy-Slot: green"', proc_name="aurora-gateway"
    )
    all_results["kb02_aurora_blue_active"] = run_benchmark_step(
        "KB02_Aurora_BlueActive_Port80", 80, proc_name="aurora-gateway"
    )
    all_results["kb02_aurora_green_authorized"] = run_benchmark_step(
        "KB02_Aurora_GreenAuthorized_Port80", 80, extra_args=f'-H "X-Deploy-Slot: green" -H "X-Preview-Secret: {SECRET}"', proc_name="aurora-gateway"
    )
    all_results["kb02_envoy_dynamic_slot"] = run_benchmark_step(
        "KB02_Envoy_DynamicSlot_Port8090", 8090, extra_args='-H "X-Deploy-Slot: green"', proc_name="envoy"
    )
    all_results["kb02_kong_routing"] = run_benchmark_step(
        "KB02_Kong_Routing_Port8000", 8000, extra_args='-H "X-Deploy-Slot: green"', proc_name="nginx"
    )

    # ==========================================
    # KB 03: CHAOS STORM & SECURITY ATTACK DEFENSE
    # ==========================================
    print("\n>>> EXECUTING KB 03: CHAOS STORM & SECURITY ATTACK DEFENSE <<<", flush=True)
    all_results["kb03_aurora_chaos_storm"] = run_benchmark_step(
        "KB03_Aurora_ChaosStorm_Port80", 80, lua_script="/tmp/bg_chaos.lua", proc_name="aurora-gateway"
    )
    all_results["kb03_nginx_map_chaos"] = run_benchmark_step(
        "KB03_NGINX_Map_Chaos_Port8089", 8089, lua_script="/tmp/bg_chaos.lua", proc_name="aurora-gateway"
    )
    all_results["kb03_envoy_chaos"] = run_benchmark_step(
        "KB03_Envoy_Chaos_Port8090", 8090, lua_script="/tmp/bg_chaos.lua", proc_name="envoy"
    )
    all_results["kb03_kong_chaos"] = run_benchmark_step(
        "KB03_Kong_Chaos_Port8000", 8000, lua_script="/tmp/bg_chaos.lua", proc_name="nginx"
    )

    out_file = "/home/phucle/Desktop/aurora-api-gateway/crates/extensions/benches/results/blue_green_azure_benchmark_results.json"
    with open(out_file, "w") as f:
        json.dump(all_results, f, indent=2)

    print("\n==================================================================", flush=True)
    print(f"[✓] FULL BENCHMARK SUITE COMPLETE! Results saved to: {out_file}", flush=True)
    print("==================================================================", flush=True)

if __name__ == "__main__":
    main()
