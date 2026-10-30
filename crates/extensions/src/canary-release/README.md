# Aurora API Gateway — Canary Release Extension

Extension **`builtin/canary-release`** cung cấp năng lực phân luồng lưu lượng phát hành canary cấp độ vi xử lý (Hardware-Accelerated Progressive Delivery), kết hợp giữa cơ chế lọc thuộc tính L7 không dùng regex (**Zero-Regex Byte Matching**) và giải thuật phân bổ phần trăm xác định (**Deterministic Weighted Rollout**) với chi phí **0.00 heap allocations** trên hot-path.

Được thiết kế tối ưu hóa cho kiến trúc phần cứng hiện đại với **64-byte L1 Data Cacheline Packing**, **SWAR 64-bit 8-Byte Load Hashing**, và **Branchless Slot Selection**, extension đạt thông lượng **~41,690 RPS** trên hạ tầng Azure thực tế, vượt qua **Kong 3.9.0 (+13.2%)** và **Envoy Proxy (+62.7%)** mà vẫn bảo toàn an toàn bộ nhớ tuyệt đối.

---

## 1. Năng Lực Cốt Lõi

1. **Phân Luồng 2 Tầng Cấp Tốc (Dual-Layer Fast-Path Routing)**:
   - **Tầng 1 (Condition Matching)**: Phân luồng ưu tiên theo điều kiện request (Header, Cookie, URI, Path, Query). Khớp ngay lập tức sang Canary Upstream mà không cần tính toán hash hay chia bucket.
   - **Tầng 2 (Percentage Rollout)**: Phân luồng theo tỷ lệ phần trăm (0% -> 100%) dựa trên hàm băm FNV-1a 64-bit nhanh cho Client IP, Cookie, hoặc Header tuỳ chọn.
2. **Bộ Khớp Byte Không Dùng Regex (Zero-Regex ByteMatcher)**:
   - Thay thế hoàn toàn regex engine nặng nề bằng các primitive phần cứng tối ưu:
     - `ExactSwar`: So khớp chuỗi $\le 8$ bytes trong đúng **1 chu kỳ CPU**.
     - `OneOf`: So khớp danh sách whitelist đa chuỗi với kiểm tra độ dài siêu tốc $O(1)$.
     - `memchr::memmem`: Tận dụng tập lệnh vector SIMD (AVX2/SSE4.2) cho `Contains`.
     - `Glob`: So khớp wildcard $O(N)$ lặp tuyến tính, triệt tiêu hoàn toàn rủi ro ReDoS (Regular Expression Denial of Service).
3. **Căn Lề Bộ Nhớ 64-Byte L1 Data Cacheline**:
   - Trường định tuyến nóng trong [`CompiledCanaryRule`](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/canary-release/policy.rs#L415-L435) được nén chặt trong đúng **64 bytes đầu tiên** (Cacheline 0). Rule không khớp route sẽ reject tức thì mà không nạp Cachelines 1, 2, 3 từ RAM.
   - Cấu trúc [`CanarySlotSheet`](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/canary-release/policy.rs#L395-L405) chứa 2 slot metadata (`[CanarySlotMeta; 2]`) chiếm đúng **64 bytes** với `#[repr(C, align(64))]`.
4. **Hàm Băm FNV-1a 64-Bit Chunked SWAR**:
   - Nạp 8 bytes `u64` nguyên khối kết hợp unrolling xử lý đuôi 4B/1B tại [`fnv1a_64`](file:///home/phucle/Desktop/aurora-api-gateway/crates/extensions/src/canary-release/engine.rs#L90-L118), giảm độ trễ nhân tuần tự từ ~39 cycles xuống ~9 cycles.
5. **Chọn Slot Không Rẽ Nhánh (Branchless Slot Selection)**:
   - Ánh xạ cờ phân luồng `is_canary as usize` trực tiếp vào chỉ mục mảng `slot_sheet.slots[...]`, loại bỏ rẽ nhánh điều kiện `if/else` khi sinh outcome.
6. **Bơm Header Chiều Xuôi (Upstream Header Injection)**:
   - Hỗ trợ gắn danh sách header tùy biến riêng biệt cho Baseline Upstream và Canary Upstream mà không tốn chi phí clone chuỗi động (`Arc<[(String, String)]>`).

---

## 2. Cấu Trúc Domain Module

Mã nguồn tuân thủ nguyên lý Single Responsibility (SRP) và workflow isolation:

```
crates/extensions/src/canary-release/
├── policy.rs      # [Đặc tả Snapshot & Phần Cứng] ByteMatcher, CanarySlotSheet (64B), CompiledCanaryRule
├── engine.rs      # [Lõi điều phối Dataplane] CanaryReleaseEngine, SIMD pre-filter, SWAR FNV-1a, evaluate
├── mod.rs         # [Public Interface Facade] Re-export gọn gàng cho Access Phase & FFI
├── tests.rs       # [Bộ kiểm thử toàn diện] Struct alignment assertions, regex lowering, RFC validation
├── BENCHMARK.md   # [Báo cáo phần cứng Azure] Đối sánh trực tiếp với Native NGINX, Kong 3.9, Envoy
├── ARCHITECTURE.md# [Kiến trúc vi mô] Sequence diagram, L1 Cacheline packing, zero-regex lowering
└── RUNBOOK.md     # [Cẩm nang vận hành] Quy trình canary rollout 0% -> 100%, rollback & telemetry
```

---

## 3. Đặc Tả Cấu Hình Khai Báo (Declarative Policy Schema)

### 3.1 Cấu Hình Mẫu Toàn Diện

```json
{
  "schema_version": 1,
  "generation": 1,
  "rules": [
    {
      "id": "canary-v2-rollout",
      "priority": 10,
      "origin": "api.example.com",
      "path_prefix": "/api/v2",
      "baseline_upstream": "payment_v1",
      "canary_upstream": "payment_v2",
      "match_conditions": [
        {
          "target": "header",
          "key": "x-canary-preview",
          "regex": "^(true|beta|vip)$"
        },
        {
          "target": "cookie",
          "key": "stage_tester",
          "operator": "exact",
          "value": "1"
        }
      ],
      "weight_percentage": 20,
      "split_by": "client_ip",
      "canary_upstream_headers": [
        { "name": "X-Upstream-Env", "value": "canary" }
      ],
      "baseline_upstream_headers": [
        { "name": "X-Upstream-Env", "value": "baseline" }
      ]
    }
  ]
}
```

### 3.2 Bảng Thuộc Tính Cấu Hình Rule

| Trường | Kiểu dữ liệu | Bắt buộc | Mặc định | Ý nghĩa kỹ thuật |
| :--- | :--- | :---: | :---: | :--- |
| `id` | `String` | **Có** | — | Định danh duy nhất cho rule, dùng cho audit và log. |
| `priority` | `u32` | Không | `100` | Mức ưu tiên đánh giá (số nhỏ hơn được ưu tiên trước). |
| `origin` | `String` | Không | `"*"` | Host header cần khớp (`*` là wildcard khớp tất cả). |
| `path_prefix` | `String` | Không | `"/"` | Tiền tố URI cần khớp (ưu tiên longest prefix). |
| `baseline_upstream` | `String` | **Có** | — | Tên cụm upstream cho nhánh ổn định (Baseline). |
| `canary_upstream` | `String` | **Có** | — | Tên cụm upstream cho nhánh thử nghiệm (Canary). |
| `match_conditions` | `Array` | Không | `[]` | Danh sách điều kiện L7 (Header, Cookie, URI, Path, Query). |
| `weight_percentage` | `u32` | Không | `0` | Tỷ lệ phần trăm lưu lượng chia vào Canary ($0 \le W \le 100$). |
| `split_by` | `String` | Không | `"client_ip"` | Cơ chế hash: `"client_ip"`, `"random"`, `"header"`, `"cookie"`. |
| `header_name` | `String` | Phụ thuộc | `null` | Tên header khi dùng `split_by: "header"`. |
| `cookie_name` | `String` | Phụ thuộc | `null` | Tên cookie khi dùng `split_by: "cookie"`. |
| `canary_upstream_headers` | `Array` | Không | `[]` | Headers tự động chèn khi chuyển sang Canary upstream. |
| `baseline_upstream_headers`| `Array` | Không | `[]` | Headers tự động chèn khi giữ ở Baseline upstream. |

---

## 4. Các Loại Điều Kiện So Khớp L7 (Match Targets)

### 4.1 Target: `header`
```json
{ "target": "header", "key": "x-beta-user", "regex": "^(true|yes)$" }
```
- Tra cứu nhanh qua con trỏ bộ nhớ `ngx_http_gateway_header_lookup` mà không sao chép chuỗi.

### 4.2 Target: `cookie`
```json
{ "target": "cookie", "key": "experiment_group", "operator": "exact", "value": "canary_a" }
```
- Tích hợp bộ tiền lọc SIMD `memchr::memmem::find` bỏ qua parsing trong ~1.5ns nếu không có key.

### 4.3 Target: `path` / `uri`
```json
{ "target": "path", "operator": "prefix", "value": "/beta/" }
```
- So khớp trực tiếp trên con trỏ byte URI của NGINX request.

### 4.4 Target: `query`
```json
{ "target": "query", "key": "preview", "operator": "exact", "value": "true" }
```
- Phân tích Query string zero-alloc, hỗ trợ cả so khớp toàn chuỗi hoặc theo key cụ thể.

---

## 5. Các Toán Tử ByteMatcher Hỗ Trợ

| Operator | Cấu hình | Ý nghĩa & Tối ưu hóa phần cứng |
| :--- | :--- | :--- |
| `exact` | `"value": "beta"` | So khớp chính xác byte-by-byte (SWAR 1 chu kỳ CPU nếu $\le 8$ bytes). |
| `one_of` | `"values": ["qa", "beta"]` | So khớp whitelist đa chuỗi, kiểm tra độ dài trước khi quét memcmp. |
| `prefix` | `"value": "/v2/"` | So khớp tiền tố byte `starts_with`. |
| `suffix` | `"value": ".json"` | So khớp hậu tố byte `ends_with`. |
| `contains` | `"value": "preview"` | So khớp chuỗi con qua thuật toán Two-Way / SIMD `memchr`. |
| `present` | *(không cần value)* | Kiểm tra header hoặc query param có tồn tại (không rỗng). |
| `regex` | `"regex": "^(a\|b)$"` | Hạ cấp tự động thành `ByteMatcher` tương ứng mà không dùng regex engine. |

---

## 6. Quan Sát & Đo Lường (Telemetry & Metrics)

Extension tích hợp trực tiếp vào module Telemetry của Aurora Gateway:

- **Biến NGINX `$gateway_upstream`**: Tự động nhận giá trị `baseline_upstream` hoặc `canary_upstream` để cấp cho `proxy_pass http://$gateway_upstream;`.
- **Biến NGINX `$gateway_generation`**: Phản ánh phiên bản chính sách SHM đang chạy.
- **Prometheus Metrics**:
  - `gateway_requests_total{gateway="aurora-gateway", status="2xx"}`: Đếm tổng lưu lượng.
  - `gateway_request_duration_seconds_bucket`: Histogram đo độ trễ chuẩn xác microsecond.
