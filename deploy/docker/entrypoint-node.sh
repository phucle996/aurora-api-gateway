#!/usr/bin/env bash
set -e

export CONTROLLER_URL="${CONTROLLER_URL:-http://controller:8080}"
export NODE_ID="${NODE_ID:-node-01}"
export AUTH_TOKEN="${AUTH_TOKEN:-71b268cadc82c2ecfff176c7dfd5c4ac77a0e6a3cd0ae3a7d87b1b9bb686b994}"

echo "[Aurora Node: ${NODE_ID}] Cấu hình kết nối tới Controller: ${CONTROLLER_URL}..."

# Sinh file nginx.conf từ template
envsubst '${CONTROLLER_URL} ${NODE_ID} ${AUTH_TOKEN}' < /etc/nginx/nginx-node.conf.template > /etc/nginx/nginx.conf

# Sinh file policy ban đầu nếu chưa có
if [ ! -f /etc/nginx/active-policy.json ]; then
    cat <<EOF > /etc/nginx/active-policy.json
{
  "schema_version": 1,
  "block_paths": [
    "/blocked",
    "/__aurora_blocked"
  ]
}
EOF
fi

# Kiểm tra cú pháp NGINX
/opt/nginx/usr/sbin/nginx -t -c /etc/nginx/nginx.conf

echo "[Aurora Node: ${NODE_ID}] Khởi động NGINX WAF Data Plane..."
exec /opt/nginx/usr/sbin/nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
