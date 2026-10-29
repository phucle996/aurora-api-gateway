# Runbook: `builtin/std-log` / `access-log` Extension

<p align="center">
  <strong>Cẩm nang vận hành, quy trình xử lý sự cố (SOP), giám sát và bảo trì hệ thống Access Logging cho Aurora API Gateway.</strong>
</p>

---

## 1. Tổng quan vận hành & Chỉ tiêu sức khỏe (Operational Health Invariants)

Hệ thống ghi nhận nhật ký `builtin/std-log` phải luôn tuân thủ các chỉ số sức khỏe vận hành sau:

| Chỉ số vận hành | Ngưỡng an toàn (Healthy) | Ngưỡng cảnh báo (Warning) | Ngưỡng sự cố (Critical) |
| :--- | :---: | :---: | :---: |
| **Hot-Path Dispatch Latency** | `< 25 ns` | `25 - 50 ns` | `> 100 ns` |
| **Tỷ lệ rớt bản ghi log (`DROPPED_TASKS`)** | `0 tasks/s` | `1 - 10 tasks/s` | `> 50 tasks/s` (Nghẽn đĩa) |
| **Dung lượng hàng đợi đệm Shadow** | `< 1,000 tasks` | `1,000 - 4,000 tasks` | `> 6,000 tasks` |
| **Bộ nhớ đệm tích lũy (RSS Shadow Buffer)** | `< 5 MB` | `5 - 15 MB` | `> 30 MB` |
| **Tỷ lệ Spilled Heap Allocation** | `< 0.1%` (URI > 256B) | `0.1% - 1.0%` | `> 5.0%` (Tấn công URL dài) |

---

## 2. Đặc tả cấu hình chuẩn (Configuration Reference)

### 2.1 Cấu hình qua chỉ thị NGINX (`gateway_std_log`)

Chỉ thị cấu hình chuẩn của Aurora Gateway là `gateway_std_log`:

```nginx
http {
    # NGINX native log handler đã bị triệt tiêu hoàn toàn khỏi NGX_HTTP_LOG_PHASE trong C Core,
    # hoàn toàn không phát sinh chi phí CPU lcf->off trên hot path.

    server {
        listen 80 reuseport;
        gateway on;

        # Kích hoạt structured standard stream log của Aurora Gateway:
        # Hỗ trợ: on (stdout), off (tắt hoàn toàn), hoặc đường dẫn trực tiếp:
        gateway_std_log /var/log/aurora/access.log;
        # hoặc: gateway_std_log on; (xuất stdout chuẩn container 12-factor)

        location /api/v1 {
            proxy_pass http://backend_pool;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
        }
    }
}
```

> **Lưu ý C-ABI Direct Path Injection**: Khi truyền đường dẫn `<path>` vào `gateway_std_log <path>;`, C adapter lập tức gọi hàm FFI `aurora_gateway_set_log_path()` để nạp trực tiếp vào bộ nhớ của Rust Shadow Worker. Hoàn toàn không cần khai báo `env AURORA_STD_LOG_PATH;` trong `nginx.conf`.

### 2.2 Biến môi trường điều khiển (Container / Kubernetes)

| Biến môi trường | Giá trị hợp lệ | Mặc định | Chức năng |
| :--- | :---: | :---: | :--- |
| **`AURORA_STD_LOG`** | `1`, `true`, `0`, `false` | `0` | Kích hoạt hoặc vô hiệu hóa thu thập structured log toàn cục. |
| **`AURORA_STD_LOG_PATH`** | `stdout`, `stderr`, `/path/to/file.log` | `stdout` | Nơi xuất dòng log. Hỗ trợ standard streams hoặc file đĩa. |

---

## 3. Lệnh vận hành thường nhật (Standard Operational Commands)

### 3.1 Kiểm tra trạng thái hàng đợi và tỷ lệ rớt log
Truy vấn metrics từ endpoint Prometheus nội tại của Gateway:

```bash
curl -s http://127.0.0.1/metrics | grep -E "gateway_log_dropped|gateway_log_enqueued"
```

### 3.2 Theo dõi log trực tiếp theo thời gian thực (Real-time Stream Inspection)
Khi xuất ra stdout/journald (chế độ tiêu chuẩn systemd):

```bash
journalctl -u aurora-gateway -f -o cat | jq .
```

Nếu xuất ra file chỉ định (`/var/log/aurora/access.log`):

```bash
tail -f /var/log/aurora/access.log | jq -C '{time: .timestamp_unix_nano, ip: .client_ip, method: .method, uri: .uri, status: .status, dur_ms: .duration_ms}'
```

### 3.3 Tái nạp cấu hình không gián đoạn (Zero-Downtime Reload)
Khi bật hoặc tắt `gateway_std_log`:

```bash
sudo aurora-gateway -s reload
```

---

## 4. Quy trình xử lý sự cố chuẩn (Standard Operating Procedures - SOP)

### SOP 01: Sự cố `DROPPED_TASKS` tăng đột biến (Kênh ngầm bị nghẽn đĩa)

#### Hiện tượng:
- Metric `gateway_log_dropped_total` tăng liên tục.
- Traffic HTTP vẫn phục vụ bình thường nhưng một số dòng log không xuất hiện trên file/stdout.
- Lệnh `iostat -x 1` hiển thị ổ đĩa lưu log có `%util > 95%`.

#### Nguyên nhân gốc:
Hạ tầng lưu trữ (Disk I/O hoặc Network Pipe của log collector) quá chậm, không kịp xả lượng log 7-10 MB/s dưới tải cực đại (> 35,000 RPS). Cơ chế phòng vệ của Aurora tự động loại bỏ task log để bảo vệ traffic loop.

#### Biện pháp xử lý:
1. **Kiểm tra tỷ lệ nghẽn I/O**:
   ```bash
   iostat -xz 1 5
   ```
2. **Chuyển hướng stream sang ramfs/tmpfs tạm thời**:
   ```bash
   export AURORA_STD_LOG_PATH=/dev/shm/aurora_access.log
   sudo systemctl restart aurora-gateway
   ```
3. **Cấu hình Log Shipper gom batch lớn hơn**:
   Tăng batch buffer của Vector/Fluentbit lên ít nhất 10 MB trước khi đẩy sang Elasticsearch/Loki.

---

### SOP 02: Sự cố phân mảnh Heap do cuộc tấn công URI siêu dài (> 256 bytes)

#### Hiện tượng:
- Tỷ lệ cấp phát heap tăng nhẹ, RAM của gateway tăng từ ~71 MB lên > 120 MB.
- Log xuất hiện nhiều URI có độ dài dị thường (> 1,000 ký tự).

#### Nguyên nhân gốc:
Struct `InlineStrBuffer` được tối ưu stack 256 bytes cho 99.9% request thông thường. Khi bị tấn công quét lỗ hổng URL (Directory Traversal, SQLi payloads dài), hệ thống tự động kích hoạt cơ chế tràn heap `spilled: Vec<u8>`.

#### Biện pháp xử lý:
1. **Bật plugin `builtin/resource-limit`** để chặn đứng các request có URI vượt quá 1024 bytes ngay tại pha Ingress:
   ```json
   {
     "max_uri_length": 1024,
     "action": "reject"
   }
   ```
2. Các request độc hại sẽ bị từ chối với mã HTTP `414 URI Too Long` ngay tại Access Phase trước khi bước vào Log Phase.

---

### SOP 03: Quy trình xoay vòng log (Logrotate SOP)

Để tránh file log phình to làm tràn dung lượng ổ cứng:

1. Tạo cấu hình `/etc/logrotate.d/aurora-gateway`:
   ```text
   /var/log/aurora/access.log {
       daily
       missingok
       rotate 14
       compress
       delaycompress
       notifempty
       create 0640 aurora aurora
       sharedscripts
       postrotate
           [ -f /run/aurora/nginx.pid ] && kill -USR1 $(cat /run/aurora/nginx.pid)
       endscript
   }
   ```
2. Chạy thử nghiệm kiểm tra cú pháp:
   ```bash
   sudo logrotate -d /etc/logrotate.d/aurora-gateway
   ```

---

### SOP 04: Quy trình kiểm tra định dạng JSON và bảo mật dữ liệu

1. Kiểm tra tính hợp lệ của dòng log:
   ```bash
   head -n 100 /var/log/aurora/access.log | jq empty
   ```
2. Xác nhận không có rò rỉ token bí mật (Authorization Header, Bearer Tokens) trong URI:
   ```bash
   grep -i "bearer" /var/log/aurora/access.log && echo "CẢNH BÁO: Rò rỉ token trong log" || echo "OK: Không có token trong URI"
   ```
