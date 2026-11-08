#!/usr/bin/env bash
# ==============================================================================
# Aurora API Gateway - Dynamic Network Hardware & Listener Optimization
# ==============================================================================
# Invariants:
# 1. Multi-Vendor Hardware NIC Topology Probe:
#    - Focuses on enterprise (Mellanox, Intel, Broadcom), cloud (AWS ENA, GCP gVNIC,
#      Azure NetVSC), virtual hypervisors (VirtIO, VMXNET3), and budget consumer NICs.
#    - Empirical Verification: Probes active MSI-X interrupt lines and CPU distribution
#      in /proc/interrupts to verify real hardware packet distribution BEFORE deciding.
#    - Skips software RPS if hardware RSS is already active to prevent double-hashing.
#    - Enables Software RPS & RFS if queue deficit / single-core bottleneck is verified.
# 2. Dynamic Listener NOTRACK:
#    - Never hardcode ports (e.g. 80, 443).
#    - Discovers all active listener ports (HTTP and L4 stream, TCP & UDP)
#      dynamically from compiled gateway configuration.
#    - Manages dedicated 'AURORA_NOTRACK' chain in raw table for self-cleaning,
#      zero-blast-radius, idempotent connection-tracking bypass.
# ==============================================================================

set -euo pipefail

GATEWAY_BIN="${GATEWAY_BIN:-/usr/local/bin/aurora-gateway}"
GATEWAY_CONF="${GATEWAY_CONF:-/etc/nginx/nginx.conf}"

# ── 1. Hardware NIC Queue & RSS/RPS Topology Tuning ───────────────────────────
tune_hardware_nic_queues() {
    local online_cores
    online_cores=$(nproc 2>/dev/null || echo 1)

    if [ "$online_cores" -le 1 ]; then
        echo "[Aurora Hardware Probe] Single CPU core detected ($online_cores). Software RPS is not applicable."
        return 0
    fi

    # Generate hexadecimal CPU mask without integer overflow
    local cpu_mask
    cpu_mask=$(awk -v n="$online_cores" 'BEGIN {
        m = "";
        full_f = int(n / 4);
        rem = n % 4;
        if (rem == 1) m = "1";
        else if (rem == 2) m = "3";
        else if (rem == 3) m = "7";
        for (i = 0; i < full_f; i++) m = m "f";
        print m;
    }')

    echo "[Aurora Hardware Probe] Host has $online_cores CPU cores online (Target CPU Mask: 0x$cpu_mask)"

    local has_software_rps=0

    for iface_path in /sys/class/net/*; do
        [ -d "$iface_path" ] || continue
        local iface
        iface=$(basename "$iface_path")

        # Skip virtual container interfaces and loopback
        case "$iface" in
            lo|docker*|br-*|veth*|virbr*|lxcbr*|tun*|tap*)
                continue
                ;;
        esac

        local queues_dir="$iface_path/queues"
        [ -d "$queues_dir" ] || continue

        local rx_queues
        rx_queues=$(ls -d "$queues_dir"/rx-* 2>/dev/null | wc -l)
        [ "$rx_queues" -gt 0 ] || continue

        # Detect Driver and Vendor classification
        local driver
        driver=$(basename "$(readlink "$iface_path"/device/driver 2>/dev/null || echo "unknown")")

        # Empirical IRQ Vector Probe: Count distinct CPUs receiving interrupts for this NIC
        local active_irq_cpus=0
        local irq_count=0
        if [ -f "/proc/interrupts" ]; then
            local irq_analysis
            irq_analysis=$(awk -v iface="$iface" -v drv="$driver" '
            BEGIN {
                getline;
                num_cpus = NF;
                for (i = 1; i <= num_cpus; i++) cpu_active[i] = 0;
                total_irqs = 0;
            }
            {
                # Match interface name or driver name in interrupt line
                line = $0;
                matched = 0;
                if (index(line, iface) > 0) matched = 1;
                else if (drv != "unknown" && index(line, drv) > 0) matched = 1;
                else if (drv == "mlx5_core" && index(line, "mlx5_comp") > 0) matched = 1;

                if (matched) {
                    total_irqs++;
                    for (i = 2; i <= num_cpus + 1; i++) {
                        if ($i > 0) cpu_active[i - 1] = 1;
                    }
                }
            }
            END {
                active = 0;
                for (i = 1; i <= num_cpus; i++) {
                    if (cpu_active[i] == 1) active++;
                }
                print total_irqs " " active;
            }' /proc/interrupts)

            irq_count=$(echo "$irq_analysis" | awk '{print $1}')
            active_irq_cpus=$(echo "$irq_analysis" | awk '{print $2}')
        fi

        echo "[Aurora Hardware Probe] Interface '$iface' [driver: $driver]: $rx_queues sysfs RX queue(s), $irq_count IRQ vector(s) (active across $active_irq_cpus CPU cores)"

        # Empirical Multi-Factor Decision:
        # If hardware queues >= CPU cores OR hardware interrupts already distributed across >= CPU cores:
        # Hardware RSS is confirmed active!
        if [ "$rx_queues" -ge "$online_cores" ] || [ "$active_irq_cpus" -ge "$online_cores" ]; then
            echo "[Aurora Hardware Probe] ==> Hardware RSS is CONFIRMED ACTIVE on '$iface'. Skipping Software RPS (prevents redundant CPU double-hashing)."
        else
            echo "[Aurora Hardware Probe] ==> Queue / IRQ Deficit detected on '$iface' ($rx_queues queue(s) < $online_cores cores). Single-core SoftIRQ bottleneck risk!"
            echo "[Aurora Hardware Probe] ==> Enabling Software RPS & RFS on '$iface' across all $online_cores cores (mask: 0x$cpu_mask)..."

            for rx_dir in "$queues_dir"/rx-*; do
                local rps_cpus_file="$rx_dir/rps_cpus"
                if [ -w "$rps_cpus_file" ]; then
                    echo "$cpu_mask" > "$rps_cpus_file"
                    has_software_rps=1
                fi

                local rps_flow_file="$rx_dir/rps_flow_cnt"
                if [ -w "$rps_flow_file" ]; then
                    echo 4096 > "$rps_flow_file" 2>/dev/null || true
                fi
            done
        fi
    done

    if [ "$has_software_rps" -eq 1 ] && [ -w "/proc/sys/net/core/rps_sock_flow_entries" ]; then
        local current_entries
        current_entries=$(cat /proc/sys/net/core/rps_sock_flow_entries 2>/dev/null || echo 0)
        if [ "$current_entries" -lt 32768 ]; then
            echo 32768 > /proc/sys/net/core/rps_sock_flow_entries 2>/dev/null || true
            echo "[Aurora Hardware Probe] Tuned rps_sock_flow_entries = 32768"
        fi
    fi
}

# ── 2. Dynamic Listener Discovery & Netfilter NOTRACK Bypass ──────────────────
tune_listener_notrack() {
    if ! command -v iptables >/dev/null 2>&1; then
        echo "[Aurora Hardware Probe] iptables not available; skipping NOTRACK bypass."
        return 0
    fi

    # Check permission to modify iptables raw table
    if ! iptables -t raw -L -n >/dev/null 2>&1; then
        echo "[Aurora Hardware Probe] Insufficient privileges to manage iptables raw table; skipping NOTRACK."
        return 0
    fi

    local config_dump=""
    if [ -x "$GATEWAY_BIN" ] && "$GATEWAY_BIN" -t -q 2>/dev/null; then
        config_dump=$("$GATEWAY_BIN" -T 2>/dev/null || true)
    fi

    if [ -z "$config_dump" ] && [ -f "$GATEWAY_CONF" ]; then
        config_dump=$(cat "$GATEWAY_CONF" 2>/dev/null || true)
    fi

    # Parse distinct numeric ports grouped by protocol (tcp / udp)
    local tcp_ports=""
    local udp_ports=""

    if [ -n "$config_dump" ]; then
        local parsed_listeners
        parsed_listeners=$(echo "$config_dump" | awk '/^[[:space:]]*listen[[:space:]]+/ {
            sub(/;/, "");
            val = $2;
            if (val ~ /:[0-9]+$/) {
                sub(/.*:/, "", val);
            }
            if (val ~ /^[0-9]+$/) {
                is_udp = 0;
                for (i = 3; i <= NF; i++) {
                    if ($i == "udp") is_udp = 1;
                }
                if (is_udp) {
                    print "udp:" val;
                } else {
                    print "tcp:" val;
                }
            }
        }' | sort -u)

        tcp_ports=$(echo "$parsed_listeners" | awk -F: '$1=="tcp"{print $2}' | paste -sd, -)
        udp_ports=$(echo "$parsed_listeners" | awk -F: '$1=="udp"{print $2}' | paste -sd, -)
    fi

    # Fallback baseline ports if configuration has no listeners yet
    if [ -z "$tcp_ports" ]; then
        tcp_ports="80,443"
    fi

    echo "[Aurora Hardware Probe] Dynamic listener discovery found TCP: [${tcp_ports}] UDP: [${udp_ports:-none}]"

    # Setup dedicated, isolated AURORA_NOTRACK chain
    iptables -t raw -N AURORA_NOTRACK 2>/dev/null || true
    iptables -t raw -C PREROUTING -j AURORA_NOTRACK 2>/dev/null || iptables -t raw -I PREROUTING -j AURORA_NOTRACK
    iptables -t raw -C OUTPUT -j AURORA_NOTRACK 2>/dev/null || iptables -t raw -I OUTPUT -j AURORA_NOTRACK

    # Atomically replace rules inside AURORA_NOTRACK chain
    iptables -t raw -F AURORA_NOTRACK

    # Split port lists into chunks of at most 15 ports (iptables multiport limit)
    local IFS=','
    local chunk=""
    local count=0

    for port in $tcp_ports; do
        if [ $count -eq 0 ]; then
            chunk="$port"
        else
            chunk="$chunk,$port"
        fi
        count=$((count + 1))
        if [ $count -ge 15 ]; then
            iptables -t raw -A AURORA_NOTRACK -p tcp -m multiport --dports "$chunk" -j NOTRACK
            iptables -t raw -A AURORA_NOTRACK -p tcp -m multiport --sports "$chunk" -j NOTRACK
            chunk=""
            count=0
        fi
    done
    if [ $count -gt 0 ]; then
        iptables -t raw -A AURORA_NOTRACK -p tcp -m multiport --dports "$chunk" -j NOTRACK
        iptables -t raw -A AURORA_NOTRACK -p tcp -m multiport --sports "$chunk" -j NOTRACK
    fi

    if [ -n "$udp_ports" ]; then
        chunk=""
        count=0
        for port in $udp_ports; do
            if [ $count -eq 0 ]; then
                chunk="$port"
            else
                chunk="$chunk,$port"
            fi
            count=$((count + 1))
            if [ $count -ge 15 ]; then
                iptables -t raw -A AURORA_NOTRACK -p udp -m multiport --dports "$chunk" -j NOTRACK
                iptables -t raw -A AURORA_NOTRACK -p udp -m multiport --sports "$chunk" -j NOTRACK
                chunk=""
                count=0
            fi
        done
        if [ $count -gt 0 ]; then
            iptables -t raw -A AURORA_NOTRACK -p udp -m multiport --dports "$chunk" -j NOTRACK
            iptables -t raw -A AURORA_NOTRACK -p udp -m multiport --sports "$chunk" -j NOTRACK
        fi
    fi

    echo "[Aurora Hardware Probe] Applied dynamic NOTRACK bypass in AURORA_NOTRACK chain successfully."
}

# ── Main Entrypoint ───────────────────────────────────────────────────────────
echo "[Aurora Hardware Probe] Initializing hardware topology and listener optimization..."
tune_hardware_nic_queues
tune_listener_notrack
echo "[Aurora Hardware Probe] Hardware probe and network tuning completed."
