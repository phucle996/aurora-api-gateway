# Aurora API Gateway — Request Termination Operational Runbook

Cẩm nang này hướng dẫn các quy trình vận hành thực chiến cho extension **`builtin/request-termination`** (Slot 10) trên môi trường Production: từ bật/tắt chế độ bảo trì toàn trạm, kiểm tra bypass nội bộ, mock API, đến xử lý sự cố.

---

## 1. Kích Hoạt Chế Độ Bảo Trì Khẩn Cấp (Emergency Maintenance)

### 1.1 Kịch Bản
Cơ sở dữ liệu hoặc hệ thống backend gặp sự cố nghiêm trọng. Cần chặn đứng 100% lưu lượng bên ngoài trong vòng 1 giây để bảo vệ cơ sở dữ liệu không bị sập hoàn toàn.

### 1.2 Thực Thi
Tạo tệp snapshot `/etc/aurora/maintenance_policy.json`:

```json
{
  "schema_version": 1,
  "generation": 1001,
  "rules": [
    {
      "id": "emergency-maintenance",
      "priority": 1,
      "origin": "*",
      "path_prefix": "/",
      "status_code": 503,
      "content_type": "application/json; charset=utf-8",
      "body": "{\"code\":\"MAINTENANCE_MODE\",\"message\":\"He thong dang bao tri cap nhat, quy khach vui long quay lai sau 15 phut.\"}",
      "headers": [
        { "name": "Retry-After", "value": "900" }
      ],
      "bypass_headers": [
        { "name": "X-Maintenance-Token", "value": "aurora-hotfix-bypass-pass-2026" }
      ]
    }
  ]
}
```

Nạp trực tiếp vào SHM Slot 10 qua CLI hoặc Python:

```bash
# Nạp tức thì qua SHM (0 downtime, 0 reload)
python3 -c "
import mmap, struct, time, zlib, json
with open('/dev/shm/aurora_gateway_policy.bin', 'r+b') as f:
    mm = mmap.mmap(f.fileno(), 1052672)
    with open('/etc/aurora/maintenance_policy.json') as pf:
        raw = pf.read().encode('utf-8')
    slot_10_off = 4096 + 10 * 65536
    crc = zlib.crc32(raw)
    gen = struct.unpack_from('<Q', mm, slot_10_off + 8)[0] + 1
    now_ms = int(time.time() * 1000)
    mm[slot_10_off + 64 : slot_10_off + 64 + len(raw)] = raw
    struct.pack_into('<IIQQI', mm, slot_10_off, 10, crc, gen, now_ms, len(raw))
    total_gen = struct.unpack_from('<Q', mm, 8)[0] + 1
    struct.pack_into('<Q', mm, 8, total_gen)
    mm.flush()
    print('Maintenance Mode ENABLED on Slot 10')
"
```

---

## 2. Kiểm Tra Vượt Rào Nội Bộ (Bypass Verification)

### 2.1 Kiểm tra từ góc độ người dùng thông thường:
```bash
curl -i http://localhost/api/v1/ping
```
**Kết quả mong đợi**: HTTP `503 Service Unavailable`, header `Retry-After: 900`, body JSON bảo trì.

### 2.2 Kiểm tra từ góc độ Kỹ sư vận hành (DevOps / Hotfix Team):
```bash
curl -i -H "X-Maintenance-Token: aurora-hotfix-bypass-pass-2026" http://localhost/api/v1/ping
```
**Kết quả mong đợi**: HTTP `200 OK` (hoặc response bình thường từ Backend). Request đi xuyên qua Gateway thành công.

---

## 3. Tắt Chế Độ Bảo Trì & Khôi Phục Lưu Lượng (Rollback / Recovery)

Khi sự cố backend đã được khắc phục, xóa cấu hình Slot 10 để mở lại 100% lưu lượng:

```bash
python3 -c "
import mmap, struct
with open('/dev/shm/aurora_gateway_policy.bin', 'r+b') as f:
    mm = mmap.mmap(f.fileno(), 1052672)
    slot_10_off = 4096 + 10 * 65536
    gen = struct.unpack_from('<Q', mm, slot_10_off + 8)[0] + 1
    struct.pack_into('<Q', mm, slot_10_off + 8, gen)
    struct.pack_into('<I', mm, slot_10_off + 24, 0) # length = 0
    total_gen = struct.unpack_from('<Q', mm, 8)[0] + 1
    struct.pack_into('<Q', mm, 8, total_gen)
    mm.flush()
    print('Maintenance Mode DISABLED. Normal traffic resumed.')
"
```

---

## 4. Giám Sát & Đo Đạc Chỉ Số (Telemetry & Observability)

1. **Kiểm tra Logs Truy Cập**:
   - Khi request bị ngắt mạch, Gateway ghi nhận mã trạng thái `status = 503` (hoặc status tương ứng) với thời gian xử lý cực ngắn (`request_time < 0.001s`).
2. **Prometheus Metrics**:
   - `aurora_gateway_requests_total{status="503"}`: Tăng vọt khi bật bảo trì.
   - `aurora_gateway_upstream_requests_total`: Lập tức giảm về 0 (chỉ có các request mang bypass header đi vào upstream).
