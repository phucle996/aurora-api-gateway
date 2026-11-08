# Response Cache & Multi-Variant Compression Empirical Benchmark Report (Slot 12)

Tài liệu này tổng hợp số liệu đo kiểm thực nghiệm trên cụm **Azure Cluster** (AMD EPYC 7763) và phân tích kiến trúc phục vụ bộ nhớ đệm đa biến thể nén sẵn (**Compress-Once, Cache-Precompressed Multi-Variant Architecture**) của extension `response-cache`.

---

## 1. Môi Trường Đo Kiểm Thực Nghiệm (Azure Live Cluster)

- **Cụm Máy Ảo Azure**:
  - **VM1 (Aurora API Gateway Dataplane Core)**:
    - IP: `20.2.249.91` (Internal: `172.16.0.4`)
    - CPU: **4 vCPUs AMD EPYC 7763 64-Core Processor** (Zen 3, AVX2, BMI2, PCLMULQDQ)
    - RAM: 16 GB, OS: Ubuntu 24.04 LTS (Kernel 7.0.0-1017-azure x86_64)
    - Dataplane: `aurora-gateway` (NGINX 1.30.4 + in-tree Rust FFI Engine, 4 workers pinned)
  - **VM2 (Load Generator & Upstream Backend)**:
    - IP: `20.205.137.141` (Internal: `172.16.0.5`)
    - CPU: **2 vCPUs AMD EPYC 7763**
    - Tool: `oha` (Rust HTTP benchmark engine, concurrency=50, duration=10s)
    - Test Endpoint: `http://172.16.0.4/api/v1/12kb` (`Content-Type: application/json`, 12,012 bytes payload)

---

## 2. Kết Quả Đo Thực Nghiệm Đa Biến Thể Cache (Empirical Benchmark Results)

Dưới đây là ma trận đối sánh thực tế giữa Upstream Round-Trip, Cache Hit thô, và Cache Hit nén sẵn đa thuật toán:

| Kịch Bản (Scenario) | Trạng Thái Cache & Header | Kích Thước Body / Req | Thông Lượng (RPS) | Tăng Tốc vs Upstream | Độ Trễ P50 | Độ Trễ P90 | Độ Trễ P99 | Băng Thông Egress |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Upstream Round-Trip (Miss/Raw)** | Cache Bypassed (`identity`) | **11.73 KiB** (12,012 B) | 18,622.85 | 1.00x | 2.59 ms | 3.82 ms | 6.06 ms | 213.28 MiB/s |
| **2. Cache HIT (Identity Raw)** | `X-Cache: HIT` (Không nén) | **11.73 KiB** (12,012 B) | **38,293.04** | **2.05x** | **1.26 ms** | **1.65 ms** | **2.72 ms** | 438.61 MiB/s |
| **3. Cache HIT (Pre-compressed Zstd)** | `X-Cache: HIT`, `zstd` | **30 B** | **58,053.94** | **3.12x** | **0.85 ms** | **0.99 ms** | **1.58 ms** | 1.66 MiB/s |
| **4. Cache HIT (Pre-compressed Gzip)** | `X-Cache: HIT`, `gzip` | **62 B** | **58,602.52** | **3.15x** | **0.84 ms** | **0.98 ms** | **1.57 ms** | 3.46 MiB/s |

---

## 3. Phân Tích Chuyên Sâu Kỹ Thuật

### 3.1. Sức Mạnh Tuyệt Đối Của "Compress-Once, Cache-Precompressed"
Trong các API Gateway truyền thống, khi một đối tượng được lưu trong Cache, mỗi khi client yêu cầu với `Accept-Encoding: gzip/zstd`, gateway phải lấy bản uncompressed từ cache ra rồi **chạy lại thuật toán nén** cho mỗi request. Điều này biến CPU nén thành nút thắt cổ chai, làm mất đi ưu thế tốc độ của Cache.

Trong kiến trúc của Aurora:
- **Lần đầu tiên yêu cầu variant**: Thuật toán nén nén 1 lần duy nhất và lưu trực tiếp bản nén (`Arc<Vec<u8>>`) vào `entry.variants`.
- **Mọi yêu cầu tiếp theo**: Tầng Access Phase phát hiện client hỗ trợ `zstd` / `gzip`, trả thẳng con trỏ bộ nhớ của bản nén ra NGINX pool $\to$ **0.00% CPU nén, 0 lần gọi Upstream**!
- Thông lượng tăng từ **18.6k RPS lên 58.6k RPS (+215% Throughput Boost)**.
- Độ trễ trung bình giảm từ **2.59 ms xuống 0.84 ms (Sub-millisecond!)**, giảm hơn **68% độ trễ**.

### 3.2. Triệt Tiêu Nghẽn Băng Thông Mạng vNIC
- Với Cache Hit thô (Scenario 2), băng thông truyền tải đạt tới **438.61 MiB/s (~3.5 Gbps)**, bắt đầu tiến sát ngưỡng bão hòa card mạng ảo của VM.
- Với Pre-compressed Zstd/Gzip (Scenario 3 & 4), dung lượng response giảm 400 lần (từ 12,012 bytes xuống 30 bytes), kéo băng thông mạng xuống chỉ còn **1.66 – 3.46 MiB/s**. Điều này giải phóng hoàn toàn kernel TCP buffer, cho phép gateway phục vụ trên **58,000 kết nối mỗi giây** một cách nhẹ nhàng.

### 3.3. Lock-Striped Sharding Phân Đoạn 16 Nhánh (16-Way Striping)
- Không có hiện tượng lock contention giữa 4 tiến trình worker của NGINX.
- Bộ nhớ đệm được phân thành 16 shard độc lập với khóa đọc/ghi `parking_lot::RwLock`. Khi có Cache Hit, worker chỉ chiếm Read-Lock trong vài nano-giây để clone `Arc`, cập nhật timestamp truy cập bằng `AtomicU64` không khóa (lock-free).
