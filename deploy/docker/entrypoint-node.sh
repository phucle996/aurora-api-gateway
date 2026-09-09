#!/usr/bin/env bash
set -e

export CONTROLLER_URL="${CONTROLLER_URL:-http://controller:8080}"
export NODE_ID="${NODE_ID:-node-01}"
NGINX_RAW_VER=$(/opt/nginx/usr/sbin/nginx -v 2>&1 | sed -n 's/.*nginx\/\([0-9.]*\).*/\1/p')
export NODE_VERSION="${NODE_VERSION:-${NGINX_RAW_VER:-1.30.4}}"
if [ -z "${AUTH_TOKEN:-}" ]; then
  if [ "${AURORA_ENV:-}" = "production" ] || [ "${NODE_ENV:-}" = "production" ]; then
    echo "FATAL: In production environment, AUTH_TOKEN must be explicitly provided for node communication!" >&2
    exit 1
  else
    export AUTH_TOKEN="71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994"
  fi
fi
export HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-5}"
export AURORA_SERVER_URL="${CONTROLLER_URL}"
export AURORA_NODE_ID="${NODE_ID}"
export AURORA_AUTH_TOKEN="${AUTH_TOKEN}"

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
# This endpoint only serves a sanitized view; raw credentials never leave the node.
sed -E 's/aurora_waf_token[[:space:]]+[^;]*;/aurora_waf_token [REDACTED];/' /etc/nginx/nginx.conf > /etc/nginx/aurora-config-view.conf
chmod 600 /etc/nginx/nginx.conf
chmod 644 /etc/nginx/aurora-config-view.conf

# Policy directory survives container replacement in a per-node volume.
umask 077
mkdir -p /var/lib/aurora-policy
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

if [ ! -f /var/lib/aurora-policy/active-upstreams.conf ]; then
    printf '%s\n' '# Aurora WAF initial active upstreams' > /var/lib/aurora-policy/active-upstreams.conf
fi

chown -R nginx:nginx /var/lib/aurora-policy
chmod 700 /var/lib/aurora-policy

# Routing servers share the same WAF enforcement and node identity as the workload server.
cat > /etc/nginx/domain-waf.conf <<EOF
aurora_waf on;
aurora_waf_policy /var/lib/aurora-policy/active-policy.json;
aurora_access_policy /var/lib/aurora-policy/active-access.json;
aurora_waf_mode enforce;
aurora_waf_controller ${CONTROLLER_URL};
aurora_waf_node_id ${NODE_ID};
aurora_waf_token ${AUTH_TOKEN};
aurora_waf_heartbeat_interval ${HEARTBEAT_INTERVAL};
add_header X-Aurora-Node "${NODE_ID}" always;
EOF
chmod 600 /etc/nginx/domain-waf.conf
mkdir -p /var/lib/aurora-routing
chown root:root /var/lib/aurora-routing
chmod 700 /var/lib/aurora-routing
if [ ! -f /var/lib/aurora-routing/active-domain-routing.conf ]; then
    printf '# No configured domains yet\n' > /var/lib/aurora-routing/active-domain-routing.conf
fi

# Discover and validate persisted optional modules before NGINX starts.
if [ -x /node-modules.sh ]; then /node-modules.sh init; else /node-dependencies.sh init; fi

# Kiểm tra cú pháp NGINX
/opt/nginx/usr/sbin/nginx -t -c /etc/nginx/nginx.conf

echo "[Aurora Node: ${NODE_ID}] Khởi động NGINX WAF Data Plane (In-Process Native Rust)..."
/domain-routing-agent.sh &
exec /opt/nginx/usr/sbin/nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
