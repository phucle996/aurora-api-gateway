#!/usr/bin/env bash
set -e

export CONTROLLER_URL="${CONTROLLER_URL:-http://controller:8080}"
NGINX_RAW_VER=$(/opt/nginx/usr/sbin/nginx -v 2>&1 | sed -n 's/.*nginx\/\([0-9.]*\).*/\1/p')
export NODE_VERSION="${NODE_VERSION:-${NGINX_RAW_VER:-1.30.4}}"
if [ -z "${AUTH_TOKEN:-}" ]; then
  echo "FATAL: AUTH_TOKEN must be explicitly provided via environment variable!" >&2
  exit 1
fi
export HEARTBEAT_INTERVAL="${HEARTBEAT_INTERVAL:-5}"
export AURORA_SERVER_URL="${CONTROLLER_URL}"
export AURORA_AUTH_TOKEN="${AUTH_TOKEN}"
export NGINX_STUB_STATUS_URL="${NGINX_STUB_STATUS_URL:-http://127.0.0.1:80/stub_status}"
if [ -z "${NGINX_RESOLVER:-}" ]; then
  NGINX_RESOLVER="$(awk '/^nameserver[[:space:]]+/ { print $2; exit }' /etc/resolv.conf)"
fi
if [[ ! "${NGINX_RESOLVER}" =~ ^[0-9a-fA-F:.]+$ ]]; then
  echo "FATAL: NGINX_RESOLVER must be an IP address" >&2
  exit 1
fi
export NGINX_RESOLVER

echo "[Aurora Dataplane] Configuring connection to Controller: ${CONTROLLER_URL}..."

# Trust only explicitly configured proxy IPs/CIDRs, never arbitrary forwarded headers.
: > /etc/nginx/access-trusted-proxies.conf
for aurora_proxy in ${TRUSTED_PROXY_CIDRS:-}; do
    if [[ ! "$aurora_proxy" =~ ^[0-9a-fA-F:./]+$ ]]; then
        echo "Invalid trusted proxy address" >&2
        exit 1
    fi
    printf 'set_real_ip_from %s;\n' "$aurora_proxy" >> /etc/nginx/access-trusted-proxies.conf
done

# Generate nginx.conf from template
envsubst '${CONTROLLER_URL} ${AUTH_TOKEN} ${HEARTBEAT_INTERVAL} ${NGINX_RESOLVER}' < /etc/nginx/nginx-node.conf.template > /etc/nginx/nginx.conf
# This endpoint only serves a sanitized view; raw credentials never leave the node.
sed -E 's/aurora_waf_token[[:space:]]+[^;]*;/aurora_waf_token [REDACTED];/' /etc/nginx/nginx.conf > /etc/nginx/aurora-config-view.conf
chmod 600 /etc/nginx/nginx.conf
chmod 644 /etc/nginx/aurora-config-view.conf

# Policy directory survives container replacement in a per-node volume.
umask 077
mkdir -p /var/lib/aurora-policy
if [ ! -f /var/lib/aurora-policy/active-policy.json ] || ! grep -q '"schema_version"' /var/lib/aurora-policy/active-policy.json 2>/dev/null || grep -q '"mode"' /var/lib/aurora-policy/active-policy.json 2>/dev/null; then
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

if [ ! -f /var/lib/aurora-policy/active-access.json ] || ! grep -q '"generation"' /var/lib/aurora-policy/active-access.json 2>/dev/null; then
    printf '%s' '{"schema_version":1,"generation":0,"rules":[]}' > /var/lib/aurora-policy/active-access.json
fi

if [ ! -f /var/lib/aurora-policy/active-upstreams.conf ]; then
    printf '%s\n' '# Aurora API Gateway initial active upstreams' > /var/lib/aurora-policy/active-upstreams.conf
fi

if [ ! -f /var/lib/aurora-policy/active-extensions.conf ]; then
    printf '%s\n' '# Aurora API Gateway initial active extensions' > /var/lib/aurora-policy/active-extensions.conf
fi

if [ ! -f /var/lib/aurora-policy/active-extensions-http.conf ]; then
    printf '%s\n' '# Aurora API Gateway initial active HTTP-level extensions' > /var/lib/aurora-policy/active-extensions-http.conf
fi

chown -R nginx:nginx /var/lib/aurora-policy
chmod 700 /var/lib/aurora-policy

# Routing servers share the same WAF enforcement and node identity as the workload server.
cat > /etc/nginx/domain-waf.conf <<EOF
gateway on;
gateway_waf_policy /var/lib/aurora-policy/active-policy.json;
gateway_access_policy /var/lib/aurora-policy/active-access.json;
gateway_waf_mode enforce;
real_ip_header proxy_protocol;
set_real_ip_from 127.0.0.1;
set_real_ip_from ::1;
include /var/lib/aurora-policy/active-extensions.conf;
EOF
chmod 600 /etc/nginx/domain-waf.conf
mkdir -p /var/lib/aurora-routing
chown root:root /var/lib/aurora-routing
chmod 700 /var/lib/aurora-routing
if [ ! -f /var/lib/aurora-routing/active-domain-routing.conf ]; then
    printf '# No configured domains yet\n' > /var/lib/aurora-routing/active-domain-routing.conf
fi

if [ ! -f /var/lib/aurora-routing/active-l4-streams.conf ]; then
    printf '# No configured L4 streams yet\n' > /var/lib/aurora-routing/active-l4-streams.conf
fi

# Baseline for optional modules/dependencies
/extension-modules.sh init

# Validate NGINX syntax
if ! /opt/nginx/usr/sbin/nginx -t -c /etc/nginx/nginx.conf; then
    echo "Warning: Stale NGINX configuration failed syntax check. Resetting active extensions to baseline..."
    printf '%s\n' '# Aurora API Gateway initial active extensions' > /var/lib/aurora-policy/active-extensions.conf
    printf '%s\n' '# Aurora API Gateway initial active HTTP-level extensions' > /var/lib/aurora-policy/active-extensions-http.conf
    /opt/nginx/usr/sbin/nginx -t -c /etc/nginx/nginx.conf
fi

echo "[Aurora Dataplane] Starting Aurora Dataplane Agent & NGINX supervisor..."
EXEC_ARGS=(
  --controller-url "${CONTROLLER_URL}"
  --auth-token "${AUTH_TOKEN}"
  --nginx-bin "${NGINX_BIN:-/opt/nginx/usr/sbin/nginx}"
  --nginx-conf "${NGINX_CONF:-/etc/nginx/nginx.conf}"
  --policy-dir "${POLICY_DIR:-/var/lib/aurora-policy}"
  --routing-dir "${ROUTING_DIR:-/var/lib/aurora-routing}"
  --modules-dir "${MODULES_DIR:-/opt/modules}"
  --nginx-stub-status-url "${NGINX_STUB_STATUS_URL}"
)
if [ -n "${GRPC_URL:-}" ]; then
  EXEC_ARGS+=(--grpc-url "${GRPC_URL}")
fi

exec /usr/local/bin/aurora-agent "${EXEC_ARGS[@]}"
