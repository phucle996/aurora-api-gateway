#!/usr/bin/env bash
# Aurora WAF - High Availability (HA) Zero-Downtime Rolling Reload Script
# Sử dụng kỹ thuật NGINX USR2 + WINCH + QUIT để chuyển giao kết nối (Connection Draining)
set -euo pipefail

PID_FILE="${1:-build/runtime/nginx.pid}"

if [ ! -f "${PID_FILE}" ]; then
  echo "Error: Không tìm thấy file PID tại ${PID_FILE}" >&2
  exit 1
fi

OLD_PID=$(cat "${PID_FILE}")
echo "[Aurora HA Reload] Bắt đầu Zero-Downtime Rolling Upgrade cho NGINX (Old Master PID: ${OLD_PID})..."

# 1. Kiểm tra cú pháp cấu hình NGINX trước khi thực hiện
echo "[Aurora HA Reload] 1. Kiểm tra tính hợp lệ của cấu hình..."
nginx -t

# 2. Gửi tín hiệu USR2 đến Master cũ để sinh Master mới với cấu hình/binary mới
echo "[Aurora HA Reload] 2. Gửi SIGUSR2 đến Master cũ để sinh tiến trình Master mới..."
kill -USR2 "${OLD_PID}"

# Đợi file PID mới được sinh ra (NGINX đổi tên file PID cũ thành .oldbin)
NEW_PID_FILE="${PID_FILE}"
for i in {1..30}; do
  if [ -f "${PID_FILE}.oldbin" ]; then
    break
  fi
  sleep 0.2
done

if [ ! -f "${PID_FILE}.oldbin" ]; then
  echo "Lỗi: Không tìm thấy ${PID_FILE}.oldbin sau 6 giây" >&2
  exit 1
fi

NEW_PID=$(cat "${PID_FILE}")
echo "[Aurora HA Reload] -> Master mới đã sẵn sàng (New Master PID: ${NEW_PID})"

# 3. Gửi tín hiệu WINCH đến Master cũ để yêu cầu các Worker cũ ngừng nhận kết nối mới (Connection Draining)
# Các kết nối cũ đang chạy trên Worker cũ sẽ tiếp tục được phục vụ nốt cho đến khi hoàn tất
echo "[Aurora HA Reload] 3. Gửi SIGWINCH đến Master cũ để drain dần kết nối..."
kill -WINCH "${OLD_PID}"

# 4. Chờ một khoảng thời gian ngắn để Worker cũ xử lý nốt các request còn tồn đọng
DRAIN_TIMEOUT=${AURORA_DRAIN_TIMEOUT:-10}
echo "[Aurora HA Reload] 4. Đợi ${DRAIN_TIMEOUT}s để Worker cũ hoàn tất các kết nối keepalive..."
sleep "${DRAIN_TIMEOUT}"

# 5. Gửi tín hiệu QUIT đến Master cũ để tắt êm đẹp
echo "[Aurora HA Reload] 5. Gửi SIGQUIT đến Master cũ để dọn dẹp tiến trình cũ..."
kill -QUIT "${OLD_PID}"

echo "🎉 [Aurora HA Reload] Zero-Downtime Reload hoàn tất thành công! Master mới đang phục vụ tại PID: ${NEW_PID}"
