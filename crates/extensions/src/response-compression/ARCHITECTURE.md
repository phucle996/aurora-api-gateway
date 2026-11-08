# Kiến Trúc Kỹ Thuật — Response Compression Extension

Tài liệu này mô tả chi tiết kiến trúc vi mô, mô hình quản lý bộ nhớ không sao chép (**Zero-Copy Pointer Handover**), luồng thực thi trên Data Plane, và thiết kế sẵn sàng cho tầng Response Cache của extension **`builtin/response-compression`**.

---

## 1. Triết Lý Kiến Trúc: Tách Rời Ranh Giới (Dumb Pipe vs Rust Brain)

Kiến trúc truyền thống của NGINX gán trách nhiệm nén vào module `ngx_http_gzip_filter_module`. Điều này tạo ra nút thắt cổ chai lớn:
1. Nén bằng C vô hướng cũ kỹ (không tận dụng được SIMD AVX2/PCLMULQDQ).
2. Phải reload tiến trình khi đổi cấu hình.
3. Không hỗ trợ thuật toán hiện đại Zstandard.
4. Nén lại liên tục ngay cả khi response đã nằm trong cache.

**Mô hình của Aurora Gateway**:

```text
┌────────────────────────────────────────────────────────┐
│               NGINX Host (Dumb Pipe)                   │
│  - Socket epoll event loop, TLS termination            │
│  - Upstream routing (proxy_pass $aurora_target_upstream)│
│  - HTTP Request Memory Pool (r->pool)                  │
└──────────────────────────┬─────────────────────────────┘
                           │ C-ABI FFI Boundary (Zero-Copy)
┌──────────────────────────▼─────────────────────────────┐
│             Aurora Rust Extension Brain                │
│  - Egress Header Filter (SWAR Accept-Encoding Parse)   │
│  - Egress Body Filter (Zstd / Brotli / Gzip SIMD)      │
│  - Dynamic Policy via SHM RCU Slot (< 50ms)           │
│  - Pre-Compressed Cache Storage Engine                 │
└────────────────────────────────────────────────────────┘
```

---

## 2. Luồng Thực Thi Egress Pipeline (Mermaid Sequence Diagram)

```mermaid
sequenceDiagram
    autonumber
    participant C as Downstream Client
    participant NG as NGINX Event Loop
    participant FFI as C-Adapter Bridge
    participant RS as Rust Compression Extension
    participant UP as Upstream Microservice

    C->>NG: GET /api/v1/users (Accept-Encoding: gzip, zstd)
    NG->>UP: proxy_pass upstream_pool
    UP-->>NG: HTTP 200 OK (Content-Type: application/json, Body: 16 KB)

    Note over NG,RS: Giai Đoạn 1: Egress Header Filter
    NG->>FFI: ngx_http_gateway_header_filter(r)
    FFI->>RS: aurora_gateway_phase_header_filter(&input, &outcome)
    RS->>RS: 1. Radix check route override (/api/v1/users)
    RS->>RS: 2. SWAR parse: client accepts zstd & gzip
    RS->>RS: 3. Negotiate: select 'zstd' (highest preference)
    RS-->>FFI: Outcome: COMPRESS, algo: Zstd, header: Content-Encoding: zstd
    FFI->>NG: Gắn Content-Encoding: zstd, Vary: Accept-Encoding, xoá Content-Length

    Note over NG,RS: Giai Đoạn 2: Egress Body Filter (Zero-Copy)
    NG->>FFI: ngx_http_gateway_body_filter(r, in)
    FFI->>RS: aurora_gateway_phase_body_filter(&in_ptr, in_len, alloc_fn, alloc_ctx: r->pool)
    RS->>FFI: Gọi alloc_fn(r->pool, bound) -> out_ptr
    RS->>RS: Nén SIMD trực tiếp từ in_ptr vào out_ptr (Zero heap alloc!)
    RS-->>FFI: Outcome: MUTATED, out_ptr, actual_len: 3.2 KB
    FFI->>NG: Gán trực tiếp: in->buf->pos = out_ptr; in->buf->last = out_ptr + 3.2 KB
    NG-->>C: Stream 3.2 KB Zstd payload ra client socket!
```

---

## 3. Mô Hình Chuyển Giao Con Trỏ Bộ Nhớ (Zero-Copy Memory Layout)

Khác với các gateway thường copy chuỗi byte từ C sang Rust rồi copy ngược lại, Aurora sử dụng kỹ thuật **Direct In-Pool Compaction**:

```text
[NGINX Request Memory Pool (r->pool)]
┌────────────────────────────────────────────────────────────────────────┐
│ Chunk thô ban đầu (in->buf->pos .. in->buf->last) [16 KB]              │
├────────────────────────────────────────────────────────────────────────┤
│ Vùng nhớ đích (out_ptr) xin qua ngx_pnalloc(r->pool, max_bound)       │
│   ┌──────────────────────────────┬──────────────────────────────────┐  │
│   │ Byte đã nén Zstd [3.2 KB]     │ Phần dư chưa dùng (an toàn)      │  │
│   └──────────────────────────────┴──────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Input Slice**: `&[u8]` được tạo trực tiếp từ `in_ptr` mà không phân bổ bộ nhớ.
2. **Output Slice**: Được cấp phát trực tiếp trong `r->pool` qua con trỏ hàm `ngx_http_gateway_alloc`.
3. **Hoàn thành**: NGINX gán `in->buf->pos = out_ptr` và `in->buf->last = out_ptr + actual_len`. 
4. **Giải phóng**: Khi client nhận xong response, NGINX giải phóng toàn bộ `r->pool` nguyên khối trong **1 thao tác CPU duy nhất**. Rust không phải bận tâm về `free()`.

---

## 4. Tương Thích Kiến Trúc Với Cache Extension ("Compress-Once")

Khi Response Cache Extension được kích hoạt, pipeline nén kết nối mượt mà thành một hệ thống **Pre-Compressed Cache**:

```text
Client Request (Accept-Encoding: zstd)
       │
       ▼
[Access Phase: Response Cache Lookup]
       ├──► Cache HIT:
       │       Tìm thấy key "/api/v1/users" đã có sẵn bản nén "zstd" trong RAM
       │       └──► Bắn thẳng con trỏ bytes từ RAM Cache ra socket (0% CPU nén!)
       │
       └──► Cache MISS:
               ├── Upstream trả về dữ liệu thô
               ├── Egress Filter nén bằng SIMD ra 'out_ptr'
               ├── Chuyển giao 'out_ptr' cho Client
               └── Đồng thời: Copy 'out_ptr' vào RAM Cache Storage theo key ('/api/v1/users', 'zstd')
```

---

## 5. An Toàn Bộ Nhớ & Phòng Ngừa Tấn Công (Threat Model)

1. **Phòng Ngừa BREACH / CRIME**:
   - Tấn công kênh kề BREACH khai thác độ dài phản hồi bị nén khi trang chứa đồng thời bí mật (CSRF token, Session) và dữ liệu người dùng phản xạ.
   - Giải pháp tích hợp: Sử dụng `routes_override` để vô hiệu hóa nén triệt để trên các endpoint nhạy cảm (`/api/v1/auth/**`, `/api/v1/oauth/**`).
2. **Phòng Chống Zip Bomb**:
   - Extension chỉ nén chiều xuôi (Egress Compression), không giải nén request body của client, loại bỏ hoàn toàn nguy cơ cạn kiệt bộ nhớ do Decompression Bomb.
3. **Cách Ly Tràn Buffer (Buffer Overrun Defense)**:
   - Hàm [`max_compressed_len`](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/response-compression/compressor.rs#L46-L65) tính toán chính xác biên an toàn tối đa cho từng thuật toán trước khi cấp phát bộ nhớ.

---

## 6. Tối Ưu Hóa Vi Kiến Trúc & Số Học Thanh Ghi (Micro-Architectural Dispatch)

### 6.1. Packed Integer Arithmetic MIME Matching (Zero Heap Allocations)
Đánh giá Content-Type trên luồng Egress thường là nguồn gây áp lực phân bổ bộ nhớ ngầm do các lệnh chuyển chữ thường (`to_ascii_lowercase()`) và tra cứu chuỗi (`HashSet<String>`). Extension áp dụng kỹ thuật khớp số học nguyên khối trên thanh ghi:
- **`u128` Fast Path (16 bytes)**: Đọc nguyên khối chuỗi `"application/json"` vào thanh ghi 128-bit. Dựa trên bất biến bit 5 của bảng mã ASCII (mọi chữ cái tiếng Anh in hoa và in thường chỉ lệch nhau bit `0x20`, trong khi dấu `/` và số đã bật sẵn bit này), áp dụng mặt nạ `| 0x20202020_20202020_20202020_20202020_u128` để chuẩn hóa toàn bộ chữ hoa về chữ thường trong 1 chu kỳ vi xử lý, rồi so sánh đẳng thức trực tiếp với `JSON_U128 = 0x6E6F736A_2F6E6F69_74616369_6C707061` (~0.8 ns).
- **`u64` Fast Path (8 bytes)**: Khớp song song `"text/css"` và `"text/xml"` bằng thanh ghi 64-bit chuẩn hóa `0x20202020_20202020_u64`.
- **`u64` + `u16` Fast Path (10 bytes)**: Khớp `"text/plain"` qua 2 nhịp nạp từ thanh ghi.
- **Allowed Length Bitmask Filter**: Toàn bộ độ dài của các MIME type hợp lệ được tổng hợp thành mặt nạ 64-bit `allowed_len_mask`. Các yêu cầu có độ dài MIME không hợp lệ bị bác bỏ ngay lập tức bằng phép tính `(allowed_len_mask & (1u64 << len)) == 0` trong ~0.3 ns.

### 6.2. Thăm Dò Khả Năng Vector Phần Cứng & Bảng Con Trỏ Hàm Cố Định
- Trong pha khởi tạo (`ResponseCompressionEngine::new`), engine gọi `aurora_engine::hardware::probe_cpu_capabilities().safe_vector_width_bytes()` để phát hiện độ rộng tập lệnh vector của máy chủ (AVX2 32 bytes, SSE 16 bytes, SWAR 8 bytes).
- Đóng đinh con trỏ hàm chuyên biệt:
  - `parse_ae_fn: AcceptEncodingScannerFn` $\to$ quét `Accept-Encoding` không heap allocation.
  - `match_mime_fn: MimeMatcherFn` $\to$ thẩm định Content-Type số học.
  - `compressors: [CompressorFn; 4]` $\to$ bảng nhảy tĩnh `COMPRESSOR_TABLE[algorithm as usize]` gọi trực tiếp routine nén SIMD độc lập, loại bỏ hoàn toàn `match` phân nhánh lặp lại trên hot-path.
