# Aurora API Gateway — Canary Release Runbook

Tài liệu hướng dẫn quy trình vận hành chuẩn (SOP), các bước triển khai progressive delivery theo từng giai đoạn, cơ chế phục hồi sự cố khẩn cấp (Emergency Rollback) và cẩm nang xử lý sự cố cho extension **`builtin/canary-release`**.

---

## 1. Quy Trình Vận Hành Phát Hành Lũy Tiến (Progressive Delivery SOP)

```
[Giai Đoạn 0: QA Preview] ──► [Giai Đoạn 1: 5% Canary] ──► [Giai Đoạn 2: 25% Canary] ──► [Giai Đoạn 3: 50% Canary] ──► [Giai Đoạn 4: 100% Full Cutover]
  (Header / Cookie Match)       (Client IP Hash)              (Client IP Hash)              (Client IP Hash)               (Decommission Baseline)
```

---

### Giai Đoạn 0: Kiểm Thử Nội Bộ Cô Lập (Internal QA Preview)

Mục tiêu: Đưa phiên bản mới (`app_green`) vào hoạt động, nhưng **chỉ phục vụ các kỹ sư nội bộ** thông qua HTTP Header hoặc Cookie kiểm thử; 100% người dùng thực tế vẫn ở lại phiên bản cũ (`app_blue`).

1. Cập nhật cấu hình canary với tỷ lệ `weight_percentage = 0` và gán điều kiện header:

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config_json": "{\"rules\":[{\"id\":\"canary-api-v1\",\"priority\":10,\"origin\":\"*\",\"path_prefix\":\"/api/v1\",\"baseline_upstream\":\"app_blue\",\"canary_upstream\":\"app_green\",\"match_conditions\":[{\"target\":\"header\",\"key\":\"x-canary\",\"regex\":\"^(true|beta)$\"}],\"weight_percentage\":0,\"split_by\":\"client_ip\"}]}"
  }' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/config
```

2. Bật kích hoạt extension (nếu chưa bật):
```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/status
```

3. Kiểm thử xác nhận bằng lệnh `curl`:
```bash
# Phải trả về Baseline (app_blue)
curl -i http://gateway.internal/api/v1

# Phải trả về Canary (app_green)
curl -i -H "x-canary: beta" http://gateway.internal/api/v1
```

---

### Giai Đoạn 1: Mở Rộng 5% Lưu Lượng Thực Tế (5% Canary Rollout)

Mục tiêu: Bắt đầu cho $5\%$ lưu lượng ngẫu nhiên theo Client IP tiếp cận phiên bản Canary để thu thập chỉ số lỗi và độ trễ thực tế.

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config_json": "{\"rules\":[{\"id\":\"canary-api-v1\",\"priority\":10,\"origin\":\"*\",\"path_prefix\":\"/api/v1\",\"baseline_upstream\":\"app_blue\",\"canary_upstream\":\"app_green\",\"match_conditions\":[{\"target\":\"header\",\"key\":\"x-canary\",\"regex\":\"^(true|beta)$\"}],\"weight_percentage\":5,\"split_by\":\"client_ip\"}]}"
  }' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/config
```

- **Thời gian quan sát khuyến nghị**: 15 – 30 phút.
- **Tiêu chí an toàn**: Tỷ lệ lỗi 5xx trên cụm `app_green` $< 0.05\%$, độ trễ P99 không tăng quá $10\%$.

---

### Giai Đoạn 2: Tăng Tốc 25% Lưu Lượng (25% Canary Rollout)

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config_json": "{\"rules\":[{\"id\":\"canary-api-v1\",\"priority\":10,\"origin\":\"*\",\"path_prefix\":\"/api/v1\",\"baseline_upstream\":\"app_blue\",\"canary_upstream\":\"app_green\",\"match_conditions\":[{\"target\":\"header\",\"key\":\"x-canary\",\"regex\":\"^(true|beta)$\"}],\"weight_percentage\":25,\"split_by\":\"client_ip\"}]}"
  }' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/config
```

- **Thời gian quan sát khuyến nghị**: 1 – 2 giờ.

---

### Giai Đoạn 3: Cân Bằng 50% Lưu Lượng (50% Canary Rollout)

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config_json": "{\"rules\":[{\"id\":\"canary-api-v1\",\"priority\":10,\"origin\":\"*\",\"path_prefix\":\"/api/v1\",\"baseline_upstream\":\"app_blue\",\"canary_upstream\":\"app_green\",\"match_conditions\":[{\"target\":\"header\",\"key\":\"x-canary\",\"regex\":\"^(true|beta)$\"}],\"weight_percentage\":50,\"split_by\":\"client_ip\"}]}"
  }' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/config
```

---

### Giai Đoạn 4: Chuyển Đổi Hoàn Toàn 100% (100% Full Promotion)

Khi phiên bản Canary đã chứng minh ổn định tuyệt đối, nâng tỷ lệ lên $100\%$:

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config_json": "{\"rules\":[{\"id\":\"canary-api-v1\",\"priority\":10,\"origin\":\"*\",\"path_prefix\":\"/api/v1\",\"baseline_upstream\":\"app_blue\",\"canary_upstream\":\"app_green\",\"weight_percentage\":100,\"split_by\":\"client_ip\"}]}"
  }' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/config
```

Toàn bộ người dùng được chuyển hướng vào `app_green`. Có thể tiến hành bảo trì hoặc nâng cấp cụm `app_blue`.

---

## 2. Quy Trình Khôi Phục Khẩn Cấp (Emergency Rollback)

Khi phát hiện sự cố nghiêm trọng (tỷ lệ lỗi 5xx tăng vọt, memory leak, CPU spike trên backend Canary), **thi hành lệnh khôi phục về 0% ngay lập tức**:

### Cách 1: Hạ Tỷ Lệ Về 0% (Khuyến Nghị — Vẫn Giữ Preview Cho Đội Dev Sửa Lỗi)

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "config_json": "{\"rules\":[{\"id\":\"canary-api-v1\",\"priority\":10,\"origin\":\"*\",\"path_prefix\":\"/api/v1\",\"baseline_upstream\":\"app_blue\",\"canary_upstream\":\"app_green\",\"match_conditions\":[{\"target\":\"header\",\"key\":\"x-canary\",\"regex\":\"^(true|beta)$\"}],\"weight_percentage\":0,\"split_by\":\"client_ip\"}]}"
  }' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/config
```

> [!NOTE]
> 100% người dùng thực tế sẽ lập tức quay về phiên bản an toàn `app_blue`. Đội ngũ kỹ sư vẫn có thể gửi header `x-canary: beta` để debug trực tiếp lỗi trên `app_green`.

### Cách 2: Vô Hiệu Hóa Hoàn Toàn Extension Canary

```bash
curl -s -X PUT \
  -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://127.0.0.1:8080/api/v1/extensions/canary-release/status
```

Gateway sẽ bỏ qua extension Canary Release và điều hướng toàn bộ request theo route mặc định của domain.

---

## 3. Cẩm Nang Xử Lý Sự Cố (Troubleshooting Playbook)

### Sự Cố 1: Gửi Header Canary Nhưng Không Chuyển Sang Upstream Mới

**Hiện tượng**: `curl -H "x-canary: beta" http://gateway/api/v1` vẫn trả về `app_blue`.

**Các bước chẩn đoán**:
1. **Kiểm tra trạng thái extension trong Controller**:
   ```bash
   curl -s -H "Authorization: Bearer $AURORA_ADMIN_TOKEN" http://127.0.0.1:8080/api/v1/extensions/canary-release | jq '{enabled, config_json}'
   ```
   *Nếu `enabled: false`, bật lại bằng `PUT /api/v1/extensions/canary-release/status`.*

2. **Kiểm tra dữ liệu trong Shared Memory Slot 7 trên Gateway**:
   ```bash
   python3 -c '
   import struct
   with open("/dev/shm/aurora_gateway_policy.bin", "rb") as f:
       f.seek(462848)
       ext_id, cksum, gen, ts, dlen = struct.unpack("<IIQQI", f.read(28))
       f.seek(462848 + 64)
       data = f.read(dlen)
       print(f"Slot 7: ext_id={ext_id}, gen={gen}, dlen={dlen}")
       print(data.decode("utf-8", errors="ignore"))
   '
   ```
   *Đảm bảo `dlen > 0` và nội dung JSON chứa quy tắc canary mong muốn.*

3. **Kiểm tra cấu hình upstream backend**:
   ```bash
   cat /var/lib/aurora-policy/active-upstreams.conf
   ```
   *Đảm bảo `app_green` và `app_blue` không trỏ trùng vào cùng một cổng IP backend.*

---

### Sự Cố 2: Tỷ Lệ Chia Tải Không Đều Khi Dùng `split_by: "client_ip"`

**Hiện tượng**: Khi đặt `weight_percentage: 50`, toàn bộ test từ máy công cụ đều đổ dồn vào 1 upstream.

**Nguyên nhân & Khắc phục**:
- Thuật toán `split_by: "client_ip"` dùng hàm băm xác định **FNV-1a 64-bit** dựa trên địa chỉ IP của Client để duy trì tính dính phiên (Session Stickiness).
- Nếu chỉ dùng 1 máy test đơn lẻ (cùng 1 IP nguồn), giá trị `hash % 100` là bất biến, do đó 100% request từ máy đó sẽ vào cùng một nhánh.
- **Giải pháp**:
  - Dùng công cụ load test sinh nhiều IP ảo (`X-Forwarded-For`), hoặc:
  - Chuyển `split_by` sang `"random"` trong giai đoạn benchmark hiệu năng để kiểm thử chia ngẫu nhiên trên từng request.
