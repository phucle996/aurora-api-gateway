# Aurora API Gateway — Blue-Green Deployment Operational Runbook

Tài liệu này cung cấp quy trình vận hành sản xuất (Standard Operating Procedure - SOP), hướng dẫn thao tác chuyển đổi slot (Cutover/Rollback), kiểm thử nội bộ an toàn (Preview Verification), và xử lý sự cố cho kỹ sư vận hành (SRE / DevOps / NetOps).

---

## 1. Các Quy Trình Vận Hành Cốt Lõi (Core Runbooks)

### 1.1 Quy Trình Chuyển Đổi Slot Chính Thức (Atomic Production Cutover)
* **Mục tiêu**: Chuyển đổi toàn bộ lưu lượng sản xuất từ phiên bản hiện tại (Blue) sang phiên bản mới (Green) trong **0 nano-giây downtime**.
* **Thực hiện qua Aurora Control Plane API**:

```bash
# 1. Cập nhật active_slot thành "green"
curl -s -X PUT \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "enabled": true,
      "active_slot": "green",
      "blue_upstream": "app_blue",
      "green_upstream": "app_green",
      "switch_header": "x-deploy-slot"
    }
  }' \
  http://<CONTROLLER_IP>:8080/api/v1/extensions/blue-green/config
```

* **Cơ chế dưới Dataplane**:
  1. Control-Worker nhận `NodeSpec` mới qua gRPC stream.
  2. Cập nhật `active_slot = 1` trong Shared Memory (SHM) slot 8.
  3. Các NGINX worker threads lập tức đọc `active_slot = 1` và điều hướng `$gateway_upstream = app_green` ngay từ request kế tiếp.
  4. 100% các kết nối TCP keepalive đang phục vụ phiên bản cũ được giữ nguyên, không có bất kỳ connection reset nào (`0 dropped connections`).

---

### 1.2 Quy Trình Thu Hồi Khẩn Cấp (Instant Disaster Rollback)
* **Kịch bản**: Sau khi chuyển sang Green, phát hiện lỗi nghiêm trọng (tỷ lệ lỗi 5xx tăng cao, memory leak, hoặc crash ứng dụng).
* **Thời gian thực thi mục tiêu**: $< 1$ giây.

```bash
# Lập tức đảo active_slot về "blue"
curl -s -X PUT \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "enabled": true,
      "active_slot": "blue",
      "blue_upstream": "app_blue",
      "green_upstream": "app_green"
    }
  }' \
  http://<CONTROLLER_IP>:8080/api/v1/extensions/blue-green/config
```

---

### 1.3 Quy Trình Kiểm Thử Bản Staging Trước Khi Phát Hành (Preview Testing)
Khi hệ thống đang chạy ổn định trên Blue, kỹ sư QA hoặc automated E2E test suite có thể kiểm thử cụm Green mà không làm ảnh hưởng đến người dùng thực tế:

#### Cách 1: Qua HTTP Header
```bash
curl -i \
  -H "X-Deploy-Slot: green" \
  -H "X-Preview-Secret: stage-secret-2026" \
  https://api.yourdomain.com/api/v1/orders
```

#### Cách 2: Qua Cookie (Dành cho trình duyệt web / Frontend QA)
```bash
curl -i \
  --cookie "deploy_slot=green" \
  -H "X-Preview-Secret: stage-secret-2026" \
  https://api.yourdomain.com/dashboard
```

#### Cách 3: Qua Query Parameter (Dành cho Webhook hoặc liên kết nhanh)
```bash
curl -i \
  -H "X-Preview-Secret: stage-secret-2026" \
  "https://api.yourdomain.com/api/v1/webhook?deploy_slot=green"
```

> [!IMPORTANT]
> Nếu client gửi yêu cầu override nhưng thiếu hoặc sai `X-Preview-Secret`, hoặc IP client không nằm trong dải `allowed_cidrs`, Gateway sẽ **tự động và âm thầm hạ cấp về slot Blue** nhằm bảo vệ cụm Green khỏi rò rỉ dữ liệu hoặc tấn công DoS.

---

## 2. Giám Sát & Telemetry (Observability)

### 2.1 Các Chỉ Số Đo Lường Chính (Prometheus Metrics)
Kiểm tra endpoint `/metrics` trên port 80 của Gateway:

```promql
# 1. Tổng số request đi vào từng slot (Blue vs Green)
sum by (upstream) (rate(gateway_requests_total{}[1m]))

# 2. Tần suất kích hoạt Header/Cookie Override
rate(gateway_extension_blue_green_overrides_total[1m])

# 3. Tần suất các yêu cầu override bị từ chối do sai Secret hoặc ngoài CIDR
rate(gateway_extension_blue_green_unauthorized_attempts_total[1m])
```

---

## 3. Khắc Phục Sự Cố (Troubleshooting & Diagnostics)

### 3.1 Kiểm Tra Trạng Thái SHM Slot Tại Máy Chủ Gateway
Trên node VM Gateway:
```bash
# Kiểm tra log đồng bộ từ control-worker
journalctl -u aurora-control-worker -n 30 --no-pager

# Kiểm tra cú pháp NGINX và tải cấu hình
sudo /usr/local/bin/aurora-gateway -t

# Kiểm tra process Gateway Core
systemctl status aurora-gateway
```

### 3.2 Lỗi "502 Bad Gateway" Sau Khi Chuyển Sang Green
* **Nguyên nhân**:
  1. Cụm upstream `app_green` chưa được bật service hoặc sai cổng port.
  2. Firewall / Security Group chưa mở port backend giữa Gateway VM và Backend VM.
* **Cách khắc phục**:
  1. Kiểm tra trạng thái backend từ Gateway node:
     ```bash
     curl -i http://<GREEN_BACKEND_IP>:<PORT>/health
     ```
  2. Nếu backend Green gặp sự cố, thực hiện ngay **Quy Trình 1.2 (Rollback)** để đưa lưu lượng về Blue.

### 3.3 Gửi Header Override Nhưng Vẫn Rơi Vào Blue
* **Nguyên nhân**:
  1. `preview_secret` được cấu hình nhưng client không gửi kèm header `X-Preview-Secret`.
  2. Client IP không nằm trong danh sách `allowed_cidrs`.
  3. Giá trị header không phải `"green"` (ví dụ gửi `"staging"` hoặc sai chính tả).
* **Cách khắc phục**:
  - Kiểm tra xem client IP có bị NAT qua Proxy bên ngoài hay không (`curl https://ifconfig.me`).
  - Kiểm tra giá trị chuỗi mật khẩu trong file cấu hình JSON của extension.
