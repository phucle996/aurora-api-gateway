#!/usr/bin/env bash
set -e

export CONTROLLER_URL="${CONTROLLER_URL:-http://controller:8080}"
export NODE_ID="${NODE_ID:-node-01}"
NGINX_RAW_VER=$(/opt/nginx/usr/sbin/nginx -v 2>&1 | sed -n 's/.*nginx\/\([0-9.]*\).*/\1/p')
export NODE_VERSION="${NODE_VERSION:-${NGINX_RAW_VER:-1.30.4}}"
export AUTH_TOKEN="${AUTH_TOKEN:-71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994}"
export HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-15}"

echo "[Aurora Node: ${NODE_ID}] Cấu hình kết nối tới Controller: ${CONTROLLER_URL} (Heartbeat: ${HEARTBEAT_INTERVAL}s)..."

# Trust only explicitly configured proxy IPs/CIDRs, never arbitrary forwarded headers.
: > /etc/nginx/access-trusted-proxies.conf
for aurora_proxy in ${TRUSTED_PROXY_CIDRS:-}; do
    if [[ ! "$aurora_proxy" =~ ^[0-9a-fA-F:./]+$ ]]; then
        echo "Invalid trusted proxy address" >&2
        exit 1
    fi
    printf 'set_real_ip_from %s;\n' "$aurora_proxy" >> /etc/nginx/access-trusted-proxies.conf
done

# Sinh file nginx.conf từ template
envsubst '${CONTROLLER_URL} ${NODE_ID} ${AUTH_TOKEN} ${HEARTBEAT_INTERVAL}' < /etc/nginx/nginx-node.conf.template > /etc/nginx/nginx.conf

# Policy and activation journal survive container replacement in a per-node volume.
umask 077
mkdir -p /var/lib/aurora-policy /run/aurora
printf '%s' "$AUTH_TOKEN" > /run/aurora/operator.token
if [ ! -f /var/lib/aurora-policy/active-policy.json ]; then
    cat <<EOF > /var/lib/aurora-policy/active-policy.json
{
  "schema_version": 1,
  "block_paths": [
    "/blocked",
    "/__aurora_blocked"
  ]
}
EOF
fi

if [ ! -f /var/lib/aurora-policy/active-access.json ]; then
    printf '%s' '{"schema_version":1,"generation":0,"rules":[]}' > /var/lib/aurora-policy/active-access.json
fi
/usr/local/bin/aurora-policy-agent --recover-only --policy /var/lib/aurora-policy/active-access.json
/usr/local/bin/aurora-policy-agent --recover-only --policy /var/lib/aurora-policy/active-policy.json

# Kiểm tra cú pháp NGINX
/opt/nginx/usr/sbin/nginx -t -c /etc/nginx/nginx.conf

echo "[Aurora Node: ${NODE_ID}] Khởi động NGINX WAF Data Plane..."
# PID 1 supervises both children. Agent failure cannot silently leave a container
# reporting healthy forever without a reconciler; Docker restart restores it.
/opt/nginx/usr/sbin/nginx -c /etc/nginx/nginx.conf -g 'daemon off;' &
aurora_nginx_pid=$!
/usr/local/bin/aurora-policy-agent --controller "$CONTROLLER_URL" --node "$NODE_ID" \
    --token-file /run/aurora/operator.token --nginx /opt/nginx/usr/sbin/nginx \
    --config /etc/nginx/nginx.conf --prefix /etc/nginx/ \
    --policy /var/lib/aurora-policy/active-policy.json --probe http://127.0.0.1:9081/generation &
aurora_agent_pid=$!
/usr/local/bin/aurora-policy-agent --sync-kind access --controller "$CONTROLLER_URL" --node "$NODE_ID" \
    --token-file /run/aurora/operator.token --nginx /opt/nginx/usr/sbin/nginx \
    --config /etc/nginx/nginx.conf --prefix /etc/nginx/ \
    --policy /var/lib/aurora-policy/active-access.json --probe http://127.0.0.1:9081/access-generation \
    --match-log /var/log/nginx/error.log &
aurora_access_pid=$!
aurora_shutdown() {
    trap - TERM INT QUIT
    kill -TERM "$aurora_access_pid" 2>/dev/null || true
    kill -TERM "$aurora_agent_pid" 2>/dev/null || true
    kill -QUIT "$aurora_nginx_pid" 2>/dev/null || true
    wait "$aurora_agent_pid" "$aurora_access_pid" "$aurora_nginx_pid" 2>/dev/null || true
}
trap 'aurora_shutdown; exit 0' TERM INT QUIT
set +e
wait -n "$aurora_nginx_pid" "$aurora_agent_pid" "$aurora_access_pid"
aurora_exit=$?
aurora_shutdown
exit "$aurora_exit"
