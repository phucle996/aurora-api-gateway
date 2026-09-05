#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROM_BIN="${HOME}/.local/bin/prometheus"
SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
PROM_CONFIG_DIR="${HOME}/.config/prometheus"
PROM_DATA_DIR="${HOME}/.local/share/prometheus"

echo "[Prometheus Setup] 1. Kiểm tra binary Prometheus..."
if [ ! -x "${PROM_BIN}" ]; then
  echo "Prometheus binary chưa có tại ${PROM_BIN}. Đang tải bản phát hành v2.54.1..."
  mkdir -p "${HOME}/.local/bin"
  curl -sL https://github.com/prometheus/prometheus/releases/download/v2.54.1/prometheus-2.54.1.linux-amd64.tar.gz | tar -xz -C /tmp/
  cp /tmp/prometheus-2.54.1.linux-amd64/prometheus "${PROM_BIN}"
  cp /tmp/prometheus-2.54.1.linux-amd64/promtool "${HOME}/.local/bin/"
  rm -rf /tmp/prometheus-2.54.1.linux-amd64
fi
"${PROM_BIN}" --version | head -n 1

echo "[Prometheus Setup] 2. Thiết lập thư mục cấu hình và data..."
mkdir -p "${SYSTEMD_USER_DIR}" "${PROM_CONFIG_DIR}" "${PROM_DATA_DIR}"

if [ ! -f "${PROM_CONFIG_DIR}/prometheus.yml" ]; then
  cp "${SCRIPT_DIR}/prometheus.yml" "${PROM_CONFIG_DIR}/prometheus.yml"
  echo "Đã tạo cấu hình tại ${PROM_CONFIG_DIR}/prometheus.yml"
fi

cp "${SCRIPT_DIR}/prometheus.service" "${SYSTEMD_USER_DIR}/prometheus.service"
echo "Đã cài đặt systemd unit vào ${SYSTEMD_USER_DIR}/prometheus.service"

echo "[Prometheus Setup] 3. Reload systemd daemon và khởi động service..."
systemctl --user daemon-reload
systemctl --user enable --now prometheus.service

echo "[Prometheus Setup] 4. Trạng thái service:"
systemctl --user status prometheus.service --no-pager
echo ""
echo "🎉 Prometheus đã được cài đặt và đang chạy dưới systemd tại http://127.0.0.1:9090"
