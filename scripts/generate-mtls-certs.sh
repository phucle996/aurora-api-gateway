#!/usr/bin/env bash
# ==============================================================================
# Aurora API Gateway - Script khởi tạo bộ chứng chỉ mTLS nội bộ (Mutual TLS)
#
# Tạo 3 thành phần PKI:
# 1. Internal Root CA (ca.crt, ca.key) - Cơ quan ký chứng chỉ nội bộ.
# 2. Server Certificate (server.crt, server.key) - Dành cho Go Control Plane.
# 3. Client Certificate (node.crt, node.key) - Dành cho NGINX Data Plane Node.
# ==============================================================================
set -euo pipefail

TARGET_DIR="${1:-certs}"
mkdir -p "${TARGET_DIR}"
cd "${TARGET_DIR}"

echo "==> [1/3] Khởi tạo Internal Root CA..."
openssl req -x509 -newkey rsa:4096 -days 3650 -nodes \
    -keyout ca.key -out ca.crt \
    -subj "/CN=Aurora-Internal-CA/O=Aurora-WAF"

echo "==> [2/3] Khởi tạo Server Certificate cho Go Control Plane..."
openssl req -newkey rsa:2048 -nodes \
    -keyout server.key -out server.csr \
    -subj "/CN=control-plane.internal/O=Aurora-WAF"

cat <<EOF > server_ext.cnf
subjectAltName = @alt_names
[alt_names]
DNS.1 = control-plane.internal
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF

openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out server.crt -days 365 -extfile server_ext.cnf
rm -f server.csr server_ext.cnf

echo "==> [3/3] Khởi tạo Client Certificate cho NGINX Node..."
openssl req -newkey rsa:2048 -nodes \
    -keyout node.key -out node.csr \
    -subj "/CN=nginx-node.internal/O=Aurora-WAF-Nodes"

openssl x509 -req -in node.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out node.crt -days 365
rm -f node.csr

chmod 600 ca.key server.key node.key
chmod 644 ca.crt server.crt node.crt

echo ""
echo "=== ĐÃ HOÀN TẤT KHỞI TẠO CHỨNG CHỈ mTLS ==="
echo "Thư mục: ${TARGET_DIR}"
echo "- Phân phối cho Go Control Plane: ca.crt, server.crt, server.key"
echo "- Phân phối cho NGINX Node:       ca.crt, node.crt, node.key"
