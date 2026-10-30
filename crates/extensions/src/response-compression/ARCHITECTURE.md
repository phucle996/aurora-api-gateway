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
