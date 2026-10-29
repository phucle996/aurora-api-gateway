# Structured Stream & Access Log Extension (`builtin/std-log` / `access-log`)

<p align="center">
  <strong>High-throughput structured HTTP access logging with zero-allocation stack arena, lock-free Shadow Worker offloading, and pre-templated JSON byte blitting for Aurora API Gateway.</strong>
</p>

---

## 1. Extension này là gì? (What is it?)

**`builtin/std-log`** (hay module nội tại `access-log`) là extension nhật ký truy vết truy cập (HTTP Access & Audit Logging) gốc được biên dịch tĩnh trực tiếp vào lõi **Aurora API Gateway**. Extension được viết bằng **Rust**, tích hợp chặt chẽ với NGINX C ABI thông qua Foreign Function Interface (FFI) ở pha `NGX_HTTP_LOG_PHASE`.

Khác với các hệ thống ghi log truyền thống phụ thuộc vào cơ chế format chuỗi đồng bộ trên worker loop (`printf`, `sprintf`, `ngx_http_log_handler`) hoặc serialize JSON thông qua reflection/Lua table (`cjson.encode()`, `serde_json`), `builtin/std-log` áp dụng mô hình **Hai Tầng Bất Đồng Bộ Tuyệt Đối (Decoupled Asynchronous Telemetry Architecture)**:

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                     TRAFFIC WORKER (HOT PATH)                               │
 │                                                                             │
 │  [Client Response Sent] ──▶ NGX_HTTP_LOG_PHASE                              │
 │                                   │                                         │
 │                                   ▼                                         │
 │                      aurora_gateway_phase_log()                             │
 │                                   │                                         │
 │                    ┌──────────────┴──────────────┐                          │
 │                    │ subs & AURORA_SUB_STD_LOG   │                          │
 │                    └──────────────┬──────────────┘                          │
 │                          No ┌─────┴─────┐ Yes                               │
 │                             ▼           ▼                                   │
 │                        Exit < 2ns   Stack Arena Buffer (InlineStrBuffer[256])
 │                        (0 alloc)    Zero-Heap Memory Copy (< 10ns)          │
 │                                         │                                   │
 │                                         ▼                                   │
 │                                     try_send()                              │
 │                             Lock-Free Channel (< 20ns)                      │
 │                                         │                                   │
 │                                         ▼                                   │
 │                           NGINX Event Loop Tiếp Tục                         │
 └─────────────────────────────────────────┼───────────────────────────────────┘
                                           │
                        tokio::mpsc::channel(8192)
                                           │
                                           ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                SHADOW WORKER THREAD (SCHED_IDLE, NICE 19)                   │
 │                                                                             │
 │  StdLogTask ──▶ FastJsonLogTemplate::render_to_buf                       │
 │                    (Pre-templated byte blitter, branchless u64, 0 serde)    │
 │                                     │                                       │
 │                                     ▼                                       │
 │                    Batch Buffer (256 items / ~56 KB)                        │
 │                                     │                                       │
 │                                     ▼ (Threshold đạt hoặc 100ms Ticker)     │
 │                    Vectorized write_all() & flush()                         │
 │                    (stdout / stderr / file descriptor)                      │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Dùng để làm gì? (What Problem Does It Solve?)

Trong các hệ thống phân tán chịu tải lớn (> 30,000 RPS mỗi node), việc ghi chép access log thường là nguyên nhân hàng đầu gây sụt giảm băng thông và giật lag độ trễ:

- **Nút thắt I/O đĩa đồng bộ (Synchronous Disk I/O Bottleneck)**: Khi worker process trực tiếp gọi syscall `write()` trên file log, bất kỳ độ trễ I/O nào của ổ cứng (do disk flushing, fsync, hoặc tranh chấp I/O trên cloud storage EBS/Azure Disk) đều lập tức chặn đứng (block) event loop của worker, làm ngưng trệ việc tiếp nhận và xử lý traffic mới.
- **Chi phí phân mảnh bộ nhớ và GC (Serialization & Alloc Overhead)**: Việc tuần tự hóa dữ liệu ra định dạng JSON thường yêu cầu khởi tạo cây cú pháp đối tượng (AST), gọi `malloc` hàng trăm nghìn lần mỗi giây và gây áp lực dọn rác (GC pauses trong Go/LuaJIT/Java).
- **Tranh chấp khóa liên tiến trình (Lock Contention trên Log File)**: Khi nhiều worker process cùng ghi đồng thời vào một file descriptor dùng chung mà không có cơ chế đệm batch, kernel lock trên inode/file table gây tắc nghẽn nghiêm trọng khi tải tăng cao.

### Giải pháp kỹ thuật của `builtin/std-log`:
1. **0.00 ns Chặn I/O trên Hot Path (0 Blocking I/O)**: Traffic worker tuyệt đối không bao giờ thực hiện bất kỳ lệnh ghi file nào. Toàn bộ tác vụ format chuỗi và ghi ra stream được chuyển giao sang luồng phụ trợ **Shadow Worker** (`SCHED_IDLE`).
2. **Zero Heap Allocation (`InlineStrBuffer[256]`)**: Với 99.9% request thông thường (IP, method, URI, host, UA, request_id, trace_id), toàn bộ chuỗi được lưu trữ trọn vẹn trong một mảng byte inline 256 bytes trên stack. Tuyệt đối không gọi `malloc/calloc` hay cấp phát `Box`.
3. **Tiền định mẫu tĩnh (Pre-templated Byte Blitting)**: Trực tiếp sao chép các lát cắt byte JSON cố định kết hợp thuật toán in số nguyên `u64` không rẽ nhánh (branchless integer printing), triệt tiêu hoàn toàn chi phí reflection hay thư viện tuần tự hóa bên thứ ba.
4. **Đệm Gom Cụm Tự Động (256-Item Batch Flushing)**: Gom cụm 256 bản ghi log thành một khối đệm ~56 KB trước khi thực hiện một lệnh ghi duy nhất (`write_all`), giảm số lượng syscall ghi đĩa hơn 250 lần.

---

## 3. Hoạt động ra sao? (Operational Specifications & Invariants)

| Đặc tính kỹ thuật | Thông số thực nghiệm / Ngưỡng thiết kế | Cơ chế thực thi |
| :--- | :---: | :--- |
| **Hot-Path Dispatch Latency** | **< 20 ns** | Non-blocking `mpsc::try_send`, 0 lock acquisition, 0 system call. |
| **Heap Allocations trên Hot Path** | **0.00 bytes** | Lưu trữ chuỗi bằng `InlineStrBuffer` 256 bytes trên stack; chỉ cấp phát heap ngoại lệ khi URI vượt 256B. |
| **Cơ chế rẽ nhánh khi tắt (Stealth Bypass)** | **< 2.0 ns** | Kiểm tra biến cờ `subs & AURORA_SUB_STD_LOG`; thoát ngay bằng 1 lệnh test branch khi không bật logging. |
| **Thông lượng chịu tải (Throughput Preservation)** | **100%** | Throughput khi bật access log tương đương với khi chạy raw; NGINX worker không bị block bởi disk I/O. |
| **Dung lượng hàng đợi kênh ngầm** | **8,192 tasks** | Kênh không khóa bounded mpsc channel giữa Traffic Worker và Shadow Worker. |
| **Cơ chế chống tràn hàng đợi (Backpressure)** | **Non-blocking Drop Counter** | Nếu Shadow Worker bị quá tải đĩa, task mới bị loại bỏ và tăng `DROPPED_TASKS`, tuyệt đối không treo traffic worker. |
| **Chu kỳ xả đệm tối đa (Max Flush Interval)** | **100 ms** | Ticker độc lập xả đệm định kỳ ngay cả khi chưa đạt ngưỡng gom cụm 128 bản ghi. |

---

## 4. Danh mục trường dữ liệu Log (JSON Log Schema Catalog)

Mỗi dòng log được xuất ra dưới dạng một chuỗi JSON chuẩn (JSON Lines - `\n`), tương thích hoàn toàn với các hệ thống phân tích log tập trung (Vector, Fluentbit, Logstash, Datadog, Elasticsearch):

| Tên trường (Field) | Kiểu dữ liệu | Ý nghĩa & Mô tả | Ví dụ |
| :--- | :---: | :--- | :--- |
| **`timestamp_unix_nano`** | `u64` | Dấu thời gian Unix tính theo đơn vị nano giây tại thời điểm hoàn tất request. | `1729001234567890123` |
| **`client_ip`** | `string` | Địa chỉ IP của client gửi request (IPv4 hoặc IPv6). | `"192.168.1.100"` |
| **`method`** | `string` | Phương thức HTTP của request. | `"GET"`, `"POST"`, `"PUT"` |
| **`uri`** | `string` | Đường dẫn URI và chuỗi truy vấn (query string). | `"/api/v1/users?page=1"` |
| **`status`** | `u16` | Mã trạng thái HTTP trả về cho client. | `200`, `401`, `429`, `500` |
| **`duration_ms`** | `u32` | Tổng thời gian xử lý request tính bằng mili giây (từ khi nhận byte đầu tiên đến khi gửi byte cuối cùng). | `12` |
| **`bytes_sent`** | `u64` | Tổng số bytes gateway đã gửi phản hồi về cho client. | `1420` |
| **`bytes_recv`** | `u64` | Tổng số bytes gateway đã nhận từ client request. | `350` |
| **`host`** | `string` | Giá trị header `Host` gửi từ client (nếu có). | `"api.domain.com"` |
| **`user_agent`** | `string` | Giá trị header `User-Agent` của client (nếu có). | `"Mozilla/5.0 ..."` |
| **`request_id`** | `string` | Mã định danh request (`X-Request-ID` hoặc Correlation ID). | `"req-8f9a2b1c"` |
| **`trace_id`** | `string` | Mã định danh phân tán tuân thủ chuẩn W3C TraceContext (`traceparent`). | `"00-4bf92f35...-01"` |
| **`upstream_status`** | `u16` | Mã trạng thái HTTP từ backend upstream phản hồi (chỉ xuất khi có upstream). | `200` |
| **`upstream_response_ms`** | `u32` | Thời gian backend upstream phản hồi tính bằng mili giây. | `10` |

### Mẫu dòng log thực tế (Sample JSON Log Entry)
```json
{"timestamp_unix_nano":1729001234567890123,"client_ip":"172.16.0.4","method":"GET","uri":"/api/v1/echo","status":200,"duration_ms":7,"bytes_sent":285,"bytes_recv":142,"host":"172.16.0.5","user_agent":"wrk/4.2.0","request_id":"c6f3972a-9e12-4c6e-b35a-93f5b721869e","trace_id":"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01","upstream_status":200,"upstream_response_ms":6}
```

---

## 5. Hướng dẫn cấu hình (Configuration Guide)

Aurora Gateway cung cấp hai phương thức kích hoạt linh hoạt, phù hợp với cả môi trường máy chủ truyền thống (Bare-metal) và môi trường Cloud-Native (Kubernetes / Container):

### Cách 1: Cấu hình khai báo qua chỉ thị NGINX (`gateway_std_log`)

Khai báo trực tiếp trong khối `server` hoặc `location`:

```nginx
server {
    listen 80 reuseport;
    gateway on;

    # Bật tính năng thu thập structured standard stream log của Gateway:
    # 1. Xuất ra stdout chuẩn container 12-factor:
    gateway_std_log on;

    # 2. Hoặc xuất trực tiếp ra file đích (tự động nạp qua C-ABI vào Rust Shadow Worker):
    # gateway_std_log /var/log/aurora/access.log;

    location /api/v1 {
        proxy_pass http://upstream_backends;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
```

### Cách 2: Kích hoạt qua biến môi trường (12-Factor App & Container)

Không cần thay đổi file cấu hình NGINX, quản trị viên có thể kích hoạt thông qua biến môi trường:

```bash
# 1. Kích hoạt xuất ra stdout (mặc định của container runtime)
export AURORA_STD_LOG=1

# 2. Hoặc chỉ định rõ file đích để ghi nhận:
export AURORA_STD_LOG_PATH=/var/log/aurora/access.log
```

---

## 6. Mô hình Tích hợp Thu thập Log (Log Collector Integration)

Nhờ tuân thủ nguyên tắc Cloud-Native 12-Factor App (Stream logs trực tiếp ra Standard Streams), `builtin/std-log` kết nối mượt mà với mọi Log Shipper hiện đại mà không yêu cầu plugin trung gian:

```text
 ┌──────────────────────┐
 │  Aurora API Gateway  │
 │  (Shadow Worker)     │
 └──────────┬───────────┘
            │ JSON Lines (stdout / file)
            ▼
 ┌──────────────────────┐      gRPC / HTTP
 │ Fluentbit / Vector   │ ───────────────────▶ Elasticsearch / OpenSearch
 │ Log Collector Daemon │ ───────────────────▶ Grafana Loki
 └──────────────────────┘ ───────────────────▶ ClickHouse / S3 Data Lake
```

- **Vector / Fluentbit**: Thu thập trực tiếp từ `systemd journal` hoặc file log `/var/log/aurora/access.log`, tự động parse JSON không tốn chi phí regex.
- **Kubelet Container Engine**: Tự động chuyển hướng stdout sang `/var/log/pods/` để các DaemonSet thu thập an toàn.
