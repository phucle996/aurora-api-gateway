# Aurora API Gateway — Response Compression Extension

Extension **`builtin/response-compression`** cung cấp năng lực nén luồng phản hồi HTTP đa thuật toán tăng tốc phần cứng (**Hardware-Accelerated Multi-Algorithm SIMD Compression**) trên tầng Egress Data Plane của Aurora Gateway. 

Hỗ trợ đồng thời **Zstandard (`zstd`)**, **Brotli (`br`)**, và **Gzip SIMD (`gzip`)**, extension được thiết kế theo triệt lý **Zero-Copy Pointer Handover**: nén trực tiếp vào vùng nhớ NGINX Request Memory Pool thông qua con trỏ thô, triệt tiêu hoàn toàn chi phí `memcpy` và cấp phát heap trên hot-path. 

Đồng thời, extension giải phóng NGINX khỏi mọi chỉ thị nén (`gzip on;` bị loại bỏ hoàn toàn khỏi `.conf`), chuyển 100% quyền điều khiển thuật toán, cấp độ nén, và luật phân luồng theo Route sang **Aurora Rust Engine** đồng bộ nóng qua **Shared Memory RCU (< 50ms, zero-reload)**.

---

## 1. Năng Lực Cốt Lõi

1. **Bộ Ba Thuật Toán Nén Tăng Tốc Phần Cứng (SIMD Tri-Engine)**:
   - **`zstd` (Zstandard)**: Lựa chọn tối ưu hàng đầu cho REST/gRPC API hiện đại. Thông lượng nén vượt trội **> 500 MB/s/core** (nhanh gấp 3–4 lần Gzip level 4), thời gian nén microsecond với tỷ lệ nén cao.
   - **`br` (Brotli)**: Tối ưu chuyên biệt cho cấu trúc JSON, CSS, JavaScript và HTML. Giảm thêm **15% – 25% dung lượng** so với Gzip ở cùng mức tiêu thụ tài nguyên.
   - **`gzip` (SIMD Deflate)**: Tương thích 100% client cổ điển, tăng tốc bằng tập lệnh vector **AVX2 / SSE4.2 / ARM Neon** và tính toán CRC32 bằng lệnh nhân đa thức không nhớ **`PCLMULQDQ`**.
2. **Chuyển Giao Con Trỏ Zero-Copy (Pointer Handover Memory Architecture)**:
   - Đọc trực tiếp byte từ con trỏ buffer NGINX (`in->buf->pos`).
   - Cấp phát vùng nhớ đích trực tiếp từ NGINX Request Pool (`ngx_pnalloc(r->pool, max_len)`).
   - Nén SIMD thẳng vào con trỏ đích và gán trực tiếp lại cho `ngx_buf_t`. **Không có bất kỳ thao tác sao chép bộ nhớ (memcpy) hay cấp phát heap độc lập nào**. Vùng nhớ tự giải phóng trọn gói khi kết thúc vòng đời HTTP request.
3. **Sẵn Sàng Cho Tầng Cache ("Compress-Once, Cache-Precompressed")**:
   - Khi bật Response Cache Extension: Phản hồi được nén một lần duy nhất tại Egress Phase rồi lưu thẳng các bản nén (`zstd`, `br`, `gzip`) vào RAM Cache.
   - Các request tiếp theo (Cache Hit) lấy trực tiếp bản nén bắn thẳng ra socket downstream $\to$ **0.00% chi phí CPU nén, 0 lần gọi Upstream**!
4. **Định Tuyến Luật Riêng Theo Route (`PathRadixTree`)**:
   - Cho phép ghi đè cấu hình cho từng API endpoint cụ thể:
     - Tắt nén cho các endpoint nhạy cảm chứa token như `/api/v1/auth/token` để phòng ngừa tấn công kênh kề **BREACH/CRIME**.
     - Ép buộc ưu tiên `br` cho thư mục tài nguyên tĩnh `/static/`.
     - Tinh chỉnh ngưỡng kích thước `min_length` riêng cho các API dữ liệu lớn `/api/v1/reports`.
5. **Bộ Đàm Phán Header SWAR Zero-Allocation**:
   - Quét và phân tích chuỗi `Accept-Encoding` của client trong đúng **1 chu kỳ vi xử lý**, tôn trọng trọng số `q-value` (ví dụ `gzip;q=0`), tự động chọn thuật toán tối ưu nhất theo danh sách ưu tiên `prefer_algorithms`.
6. **NGINX Là "Dumb Pipe" Thuần Túy**:
   - Khối server NGINX chỉ giữ vai trò listener & upstream proxy. Không reload tiến trình NGINX khi thay đổi cấu hình nén.

---

## 2. Cấu Trúc Domain Module

Mã nguồn tuân thủ triệt để nguyên lý Workflow Isolation, toàn bộ logic nén đóng gói bên trong `crates/extensions`:

```
crates/extensions/src/response-compression/
├── policy.rs        # [Đặc tả Schema] ResponseCompressionConfig, RouteCompressionOverride, MIME sanitization
├── compressor.rs    # [SIMD Compressors] Zero-copy routines cho Zstd, Brotli, Gzip-SIMD
├── evaluator.rs     # [Lõi Thẩm Định Egress] Radix route matcher, SWAR Accept-Encoding, pointer handover
├── materialize.rs   # [Materializer] Biên dịch cấu hình SHM Slot (NGINX conf giữ sạch 100%)
├── mod.rs           # [Public Interface Facade] Re-export cho FFI boundary
├── tests.rs         # [Bộ Kiểm Thử Đơn Vị] Unit tests, mock C allocator, algorithm verification
├── README.md        # [Tài Liệu Kỹ Thuật Tổng Thể]
├── ARCHITECTURE.md  # [Kiến Trúc Con Trỏ & FFI Pipeline]
├── RUNBOOK.md       # [Cẩm Nang Vận Hành SRE]
└── BENCHMARK.md     # [Đối Sánh Throughput & Tỷ Lệ Nén]
```

---

## 3. Đặc Tả Thuộc Tính Cấu Hình (Policy Schema)

### 3.1 Bảng Tham Số Khai Báo

| Trường | Kiểu Dữ Liệu | Mặc Định | Ranh Giới Hợp Lệ | Mô Tả Kỹ Thuật |
| :--- | :--- | :--- | :--- | :--- |
| `enabled` | `boolean` | `true` | `true`, `false` | Bật/tắt nén response toàn cục trên Gateway. |
| `min_length` | `integer` | `1024` | `20 ..= 10485760` | Độ dài phản hồi tối thiểu tính theo byte để kích hoạt nén (tránh phình to payload nhỏ). |
| `prefer_algorithms` | `array<string>` | `["zstd", "br", "gzip"]` | Token: `zstd`, `br`, `gzip` | Thứ tự ưu tiên thuật toán khi client hỗ trợ nhiều encoding. |
| `zstd_level` | `integer` | `3` | `1 ..= 19` | Cấp độ nén Zstandard. Mặc định tối ưu: 3. |
| `brotli_level` | `integer` | `4` | `1 ..= 11` | Cấp độ nén Brotli. Mặc định tối ưu: 4. |
| `gzip_level` | `integer` | `4` | `1 ..= 9` | Cấp độ nén Gzip SIMD. Mặc định tối ưu: 4. |
| `types` | `array<string>` | *(10 MIME types)* | RFC 6838 MIME | Danh mục các kiểu nội dung MIME cho phép nén. |
| `routes_override` | `array<object>` | `[]` | Danh sách rules | Danh sách luật ghi đè riêng cho từng tiền tố đường dẫn (`path_prefix`). |

### 3.2 Cấu Hình Mẫu Toàn Diện

```json
{
  "enabled": true,
  "min_length": 1024,
  "prefer_algorithms": ["zstd", "br", "gzip"],
  "zstd_level": 3,
  "brotli_level": 4,
  "gzip_level": 4,
  "types": [
    "application/json",
    "text/plain",
    "text/css",
    "application/javascript",
    "text/xml",
    "application/xml",
    "application/xml+rss",
    "text/javascript",
    "image/svg+xml",
    "application/graphql+json"
  ],
  "routes_override": [
    {
      "path_prefix": "/api/v1/auth",
      "enabled": false
    },
    {
      "path_prefix": "/static/",
      "prefer_algorithms": ["br"],
      "min_length": 100
    }
  ]
}
```

---

## 4. Ranh Giới NGINX Configuration

Trình biên dịch cấu hình [`materialize`](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/response-compression/materialize.rs) nạp trực tiếp toàn bộ policy vào Shared Memory Slot (`AURORA_EXT_RESPONSE_COMPRESSION`).

File cấu hình NGINX (`active-extensions-server.conf`) **hoàn toàn sạch bóng các chỉ thị nén**:

```nginx
# Server block thuần listener & upstream router
server {
    listen 8080 reuseport;
    server_name _;

    location / {
        gateway on;
        proxy_pass http://$aurora_target_upstream;
    }
}
```
Mọi hành vi nén, đàm phán header, và cấp phát vùng nhớ diễn ra trực tiếp qua C-ABI FFI giữa C adapter và Rust Engine.
