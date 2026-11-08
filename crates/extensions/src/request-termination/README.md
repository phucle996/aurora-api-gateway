# Aurora API Gateway — Request Termination Extension

Extension **`builtin/request-termination`** cung cấp năng lực ngắt mạch sớm và phản hồi trực tiếp tại rìa Gateway (Edge Short-Circuit & Direct Response), hoạt động hoàn toàn trong tiến trình Rust Dataplane Core (**Slot 10 qua Atomic POSIX SHM**).

Được thiết kế để thay thế hoàn toàn chỉ thị NGINX `if / return` và extension `maintenance` thô sơ, extension cho phép dập tắt các đợt lưu lượng khẩn cấp, kích hoạt chế độ bảo trì toàn trạm, bảo trì từng phần, mock API hoặc khai tử endpoint cũ mà **không cần reload NGINX, zero-downtime, không rớt bất kỳ socket nào**.

---

## 1. Năng Lực Cốt Lõi

1. **Khử Nhánh HTTP Method Cấp Độ Thanh Ghi CPU (Branchless Method Masking)**:
   - Nhận diện phương thức HTTP (`GET`, `POST`, `HEAD`, `PUT`, `DELETE`, `PATCH`, `OPTIONS`, `CONNECT`, `TRACE`) chỉ trong **1-2 chu kỳ xung nhịp CPU (~0.3 ns)** nhờ đóng gói số nguyên Little-Endian (`u32`) và khử bit 5 không phân biệt hoa thường.
   - Triệt tiêu 100% chi phí duyệt chuỗi ký tự hay chuỗi so sánh tuần tự `if-else`.
2. **Đường Tắt Siêu Tốc Cho Bảo Trì Toàn Trạm (Root & Wildcard Fast-Paths)**:
   - Các quy tắc bảo trì toàn trạm (`origin: "*"`, `path_prefix: "/"`) được bật cờ `is_wildcard_origin` và `is_root_path`, đi tắt thẳng vào phép so sánh bitmask mà **hoàn toàn không chạm vào bộ nhớ chuỗi URL hoặc Host**.
3. **Cơ Chế Vượt Rào An Toàn Có Khớp Khóa Bí Mật (Value-Matched Bypass Headers)**:
   - Cho phép định nghĩa một hoặc nhiều cặp header bỏ qua ngắt mạch (ví dụ: `X-Maintenance-Bypass: secret123`).
   - Kiểm tra **cả tên header VÀ giá trị bí mật** một cách lười (Lazy Lookup - chỉ tra cứu header khi rule thực sự có cấu hình bypass), ngăn chặn hoàn toàn nguy cơ vượt rào trái phép.
4. **Khớp Header Chính Xác Tuyệt Đối (Strict Key-Value Matching)**:
   - Cả điều kiện kích hoạt ngắt mạch (`match_headers`) và cơ chế vượt rào (`bypass_headers`) đều khớp chính xác cả tên header và giá trị người dùng thiết lập, triệt tiêu hoàn toàn rủi ro bảo mật từ presence-only bypass.
5. **Zero Heap Allocation Trên Hot Path**:
   - Sử dụng bộ đệm stack và tham chiếu chuỗi mượn (borrowed slices) để chuyển giao mã lỗi, content-type, payload và custom headers sang NGINX mà không tốn chu kỳ `malloc`/`free`.
6. **Hot Reload Tức Thì Qua Atomic SHM**:
   - Cập nhật quy tắc ngắt mạch trong **~1 micro-giây** qua bộ nhớ chia sẻ POSIX SHM. Không cần reload NGINX master/worker processes.

---

## 2. Cấu Trúc Domain Module

Mã nguồn tuân thủ nguyên lý Single Responsibility (SRP) và workflow isolation:

```
crates/extensions/src/request-termination/
├── types.rs       # [Đặc tả Snapshot] RequestTerminationSnapshot, RuleInput, HeaderPair, TerminationDecision
├── engine.rs      # [Lõi Dataplane] RequestTerminationEngine, Branchless Method Mask, Lazy Bypass Lookup, evaluate
├── mod.rs         # [Public Interface Facade] Re-export gọn gàng cho Access Phase & FFI
├── tests.rs       # [Bộ kiểm thử toàn diện] Unit tests, Maintenance compatibility, Method bitmask, Mocking
├── README.md      # [Tài liệu kỹ thuật] Hướng dẫn cấu hình và các ca sử dụng điển hình
├── ARCHITECTURE.md# [Kiến trúc vi mô] Luồng ngắt mạch L7, vi kiến trúc thanh ghi, state transitions
├── RUNBOOK.md     # [Cẩm nang vận hành] Quy trình kích hoạt bảo trì khẩn cấp, mock API và rollback
└── BENCHMARK.md   # [Báo cáo phần cứng Azure] Đối sánh thực tế trên Azure Dedicated VM
```

---

## 3. Đặc Tả Cấu Hình Khai Báo (Declarative Policy Schema)

### 3.1 Cấu Hình Đầy Đủ Đa Quy Tắc (Multi-Rule Policy)

```json
{
  "schema_version": 1,
  "generation": 1001,
  "rules": [
    {
      "id": "maintenance-rule",
      "priority": 1,
      "origin": "*",
      "path_prefix": "/",
      "methods": [],
      "status_code": 503,
      "content_type": "application/json; charset=utf-8",
      "body": "{\"code\":\"SYSTEM_MAINTENANCE\",\"message\":\"He thong dang bao tri nang cap.\"}",
      "headers": [
        { "name": "Retry-After", "value": "300" }
      ],
      "bypass_headers": [
        { "name": "X-Admin-Bypass", "value": "super-secret-token-2026" }
      ]
    },
    {
      "id": "mock-payment-status",
      "priority": 10,
      "origin": "api.example.com",
      "path_prefix": "/api/v2/payments/mock",
      "methods": ["GET"],
      "status_code": 200,
      "content_type": "application/json",
      "body": "{\"status\":\"SUCCESS\",\"transaction_id\":\"tx_mock_123\"}",
      "headers": [
        { "name": "X-Mock-Engine", "value": "Aurora-Gateway" }
      ],
      "bypass_headers": []
    }
  ]
}
```

---

## 4. Bảng Thuộc Tính Cấu Hình

| Thuộc Tính | Kiểu Dữ Liệu | Mặc Định | Ý Nghĩa Kỹ Thuật |
| :--- | :--- | :--- | :--- |
| `schema_version` | `u32` | `1` | Phiên bản schema của snapshot (yêu cầu = 1) |
| `generation` | `u64` | `0` | Số thứ tự thế hệ cấu hình (hỗ trợ hot-reload không rớt kết nối) |
| `id` | `String` | `"default"` | Định danh duy nhất của quy tắc ngắt mạch |
| `priority` | `u32` | `10` | Thứ tự ưu tiên đánh giá (số nhỏ hơn được đánh giá trước) |
| `origin` | `String` | `"*"` | Domain mục tiêu (`*`, `*.example.com`, hoặc host chính xác) |
| `path_prefix` | `String` | `"/"` | Tiền tố đường dẫn URI áp dụng |
| `methods` | `Vec<String>`| `[]` | Mảng HTTP methods áp dụng (`GET`, `POST`, ...). Rỗng = áp dụng cho mọi method |
| `status_code` | `u16` | `503` | Mã trạng thái HTTP trả về khi ngắt mạch (200..=599) |
| `content_type` | `String` | `"application/json; charset=utf-8"` | Giá trị header `Content-Type` trả về |
| `body` | `String` | JSON 503 | Nội dung payload trả về (JSON, HTML, XML, Plain Text) |
| `match_headers` | `Vec<HeaderPair>` | `[]` | Danh sách cặp `{"name": key, "value": val}` request headers cần khớp để kích hoạt ngắt mạch |
| `headers` | `Vec<HeaderPair>` | `[]` | Danh sách custom response headers gửi về client khi ngắt mạch |
| `bypass_headers` | `Vec<HeaderPair>` | `[]` | Danh sách cặp `{"name": key, "value": val}` request headers được phép vượt qua (bỏ qua) ngắt mạch |

---

## 5. Các Ca Sử Dụng Điển Hình (Common Use Cases)

### 5.1 Bảo Trì Khẩn Cấp Toàn Trạm (Emergency System Maintenance)
Dập tắt toàn bộ lưu lượng vào backend, trả về 503 ngay tại Gateway với header `Retry-After: 300`:
```json
{
  "schema_version": 1,
  "generation": 1001,
  "rules": [
    {
      "id": "site-maintenance",
      "priority": 1,
      "origin": "*",
      "path_prefix": "/",
      "status_code": 503,
      "content_type": "application/json; charset=utf-8",
      "body": "{\"error\":\"He thong dang bao tri khach hang.\"}",
      "headers": [
        { "name": "Retry-After", "value": "300" }
      ],
      "bypass_headers": [
        { "name": "X-Internal-Token", "value": "internal-secret-key-999" }
      ]
    }
  ]
}
```

### 5.2 Bảo Trì Chỉ Ghi (Read-Only Maintenance Mode)
Cho phép người dùng đọc dữ liệu (`GET`), chỉ chặn các thao tác ghi dữ liệu (`POST`, `PUT`, `DELETE`, `PATCH`):
```json
{
  "schema_version": 1,
  "rules": [
    {
      "id": "read-only-maintenance",
      "priority": 1,
      "origin": "*",
      "path_prefix": "/api",
      "methods": ["POST", "PUT", "DELETE", "PATCH"],
      "status_code": 503,
      "body": "{\"error\":\"Tinh nang ghi tam thoi bao tri. Vui long quay lai sau.\"}"
    }
  ]
}
```

### 5.3 Khai Tử Endpoint Cũ (API Sunset / Deprecation)
Trả về mã `410 Gone` vĩnh viễn kèm header `Sunset`:
```json
{
  "schema_version": 1,
  "rules": [
    {
      "id": "decommission-v0",
      "priority": 1,
      "origin": "*",
      "path_prefix": "/api/v0",
      "status_code": 410,
      "body": "{\"error\":\"API v0 da ngung hoat dong. Vui long dung /api/v1.\"}",
      "headers": [
        { "name": "Sunset", "value": "Wed, 11 Nov 2026 00:00:00 GMT" }
      ]
    }
  ]
}
```
