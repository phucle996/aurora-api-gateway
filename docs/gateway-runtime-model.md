# Aurora API Gateway: Runtime Execution & Plugin Lifecycle Model

Tài liệu đặc tả toàn diện mô hình vận hành (**Runtime Execution Model**) của Aurora Gateway. Tài liệu này tích hợp **Mentor Model (Nguyên lý Data Plane Production)** và **7 Request Execution Phases**, đóng vai trò là "kim chỉ nam" cho kiến trúc Dataplane và nền tảng dữ liệu để xây dựng **Visual Route Pipeline** trên giao diện Console sau này.

---

## 1. Tổng quan Kiến trúc: 5 Vòng Xử Lý Độc Lập

Hệ thống được tổ chức thành 5 vòng độc lập nhằm đảm bảo tính bất biến, hiệu năng cực cao và khả năng sống sót độc lập:

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. MANAGEMENT PLANE (UI Console, CLI, Admin REST API)                  │
│    - Quản trị viên tương tác cấu hình: Routes, Upstreams, Plugins...   │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Declarative Mutation
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. CONTROL PLANE (Go Controller)                                       │
│    - Authority Source (SQLite Database)                                │
│    - Validator, Normalizer, Conflict Detection                         │
│    - Snapshot Compiler (Biên dịch DB -> Immutable node-spec.json)      │
│    - Spec Distributor (Push / Polling qua versioned stream)            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Versioned Snapshot (SHA256, Release ID)
                                    ▼
══════════════════════════════════════════════════════════════════════════
│ 3. DATA PLANE (Rust Agent & NGINX Engine) - "Ngu nhưng cực nhanh"      │
│                                                                        │
│  [Client Request]                                                      │
│        │                                                               │
│        ▼                                                               │
│  [L4: Listener] ──> [L4: TLS Handshake (SNI Match & mTLS)]             │
│        │                                                               │
│        ▼                                                               │
│  [L7: HTTP Parser]                                                     │
│        │                                                               │
│        ▼                                                               │
│  [7-Phase Plugin Pipeline & Router] (Pre-compiled Execution Plan)      │
│        │                                                               │
│        ▼                                                               │
│  [Upstream Subsystem] ──> Balancer (RR/Hash) ──> Conn Pool ──> Backend │
│        │                                                               │
│        ▼                                                               │
│  [Client Response]                                                     │
══════════════════════════════════════════════════════════════════════════
    │                                              ▲
    │ Metrics, Spans, Audit Logs                   │ Active Conns, Counters
    ▼                                              │ Health Status
┌───────────────────────────────┐     ┌──────────────────────────────────┐
│ 4. OBSERVABILITY PLANE        │     │ 5. RUNTIME STATE STORE           │
│    - OpenTelemetry, Zipkin    │     │    - Shared Memory Zones (NGINX) │
│    - Prometheus Metrics       │     │    - Bounded Sliding Windows     │
│    - Security Events Stream   │     │    - Circuit Breaker Latencies   │
└───────────────────────────────┘     └──────────────────────────────────┘
```

---

## 2. Các Nguyên Tắc Vận Hành Cốt Lõi (Mentor Principles)

1. **Data Plane "ngu nhưng cực nhanh" (Zero DB trên Hot Path):**
   * Data Plane không query database, không hỏi Control Plane khi đang phục vụ request.
   * Tất cả chỉ là đọc bộ nhớ và thực thi trên **Immutable Runtime Snapshot** đã được compile sẵn.
2. **Failure là trạng thái bình thường (Resilience & Self-Healing):**
   * Nếu Control Plane chết $\rightarrow$ Data Plane vẫn phục vụ bình thường từ bản snapshot gần nhất trên đĩa.
   * Nếu Backend chết $\rightarrow$ Passive/Active Health Detector tự động cô lập node lỗi.
   * Nếu Route trỏ vào Upstream không tồn tại $\rightarrow$ Agent tự sinh fallback HTTP 503, tuyệt đối không để NGINX crash.
3. **Atomic Snapshot Swap (Cập nhật không gián đoạn):**
   * Snapshot v100 $\rightarrow$ Snapshot v101 được chuẩn bị và validate xong xuôi mới thực hiện hoán đổi con trỏ (Atomic pointer swap). Request đang chạy trên v100 tiếp tục hoàn tất; request mới chuyển sang v101.
4. **Compile trước mọi Execution Plan:**
   * Không quét qua 115 plugin trên mỗi request.
   * Khi compile Route, hệ thống chỉ gắn đúng các plugin mà Route đó kích hoạt vào một **Execution Plan** tuần tự.
5. **Mọi External Call đều có Deadline & Bounded Memory:**
   * Bounded body buffers, streaming inspection, không cấp phát bộ nhớ vô hạn.
   * Mọi kết nối ra ngoài (JWKS, Redis, Upstream) đều có Timeout và Fallback xác định.

---

## 3. Vòng Đời Request: 7 Phase Xử Lý Chuẩn Mực

Mỗi request đi qua Gateway được phân định qua **7 Phase cố định**, kèm theo **2 Out-of-band Lifecycle Hooks**:

```
[INIT] (Gateway Boot) ──> [CONFIGURE] (Snapshot Compiled & Loaded)
                                  │
                                  ▼
                     === REQUEST PROCESSING ===
                                  │
                                  ▼
                    ┌───────────────────────────┐
                    │     1. PRE-ROUTING        │
                    └─────────────┬─────────────┘
                                  │
                           [ ROUTER MATCH ]  (Host + Path + Method -> Route ID)
                                  │
                    ┌─────────────┴─────────────┐
                    │     2. REWRITE            │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │     3. ACCESS             │ (Auth -> Authz -> RateLimit -> WAF)
                    └─────────────┬─────────────┘
                                  │ (Early Return 401/403/429 nếu vi phạm)
                    ┌─────────────┴─────────────┐
                    │     4. BEFORE-UPSTREAM    │
                    └─────────────┬─────────────┘
                                  │
                        [ BACKEND UPSTREAM ] (Proxy Pass & Receive Response)
                                  │
                    ┌─────────────┴─────────────┐
                    │     5. HEADER-FILTER      │
                    └─────────────┬─────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │     6. BODY-FILTER        │ (Streaming PII Masking / DLP)
                    └─────────────┬─────────────┘
                                  │
                        [ CLIENT RECEIVES DATA ]
                                  │
                    ┌─────────────┴─────────────┐
                    │     7. LOG (Async)        │ (Zero-overhead Telemetry)
                    └───────────────────────────┘
```

### Chi tiết ý nghĩa và Extensions phụ trách từng Phase:

| Phase | Thời điểm thực thi | Nhiệm vụ kỹ thuật | Extensions phụ trách tiêu biểu |
| :--- | :--- | :--- | :--- |
| **`0. init`** *(Hook)* | Gateway khởi động | Khởi tạo worker, nạp shared memory, liên kết OpenSSL | N/A |
| **`0. configure`** *(Hook)* | Khi Spec thay đổi | Parse JSON, validate schema, nạp cert vào đĩa, reload | N/A |
| **`1. pre-routing`** | Ngay khi nhận socket HTTP | Bóc tách Real Client IP, sinh `X-Request-ID`, khởi tạo trace context | `request-id`, `real-ip` |
| **`2. rewrite`** | Sau khi match Route | Viết lại URI, chuẩn hóa host, can thiệp query params, **match header để rewrite path** trước khi vào logic bảo mật | `uri-rewrite`, `host-rewrite`, `method-rewrite`, `request-query-transform` |
| **`3. access`** | Trọng tài bảo mật & lưu lượng | **Gatekeeper:** Xác thực danh tính $\rightarrow$ Phân quyền $\rightarrow$ Kiểm soát tần suất $\rightarrow$ Quét lỗ hổng WAF. Ngắt ngay nếu vi phạm! | • **Auth:** `jwt-auth`, `key-auth`, `basic-auth`, `oauth2-auth`<br>• **Authz:** `acl`, `rbac`, `ip-restriction`, `geo-restriction`<br>• **Rate Limit:** `rate-limit`, `rate-limit-distributed`<br>• **WAF:** `waf-core`, `sqli-protection`, `xss-protection`, `bot-detection` |
| **`4. before-upstream`** | Ngay trước khi gửi đi | Gắn internal headers (X-Consumer-ID, SigV4), chọn balancer target, traffic shadowing | `request-header-transform`, `request-body-transform`, `request-signature`, `canary-release` |
| **`5. header-filter`** | Nhận headers từ Backend | Thêm/xóa/sửa response headers, chèn CORS, HSTS, security headers | `response-header-transform`, `cors`, `maintenance-mode`, `request-termination` |
| **`6. body-filter`** | Nhận body stream từ Backend | Quét dữ liệu nhạy cảm chiều ra, che giấu thẻ tín dụng (DLP Masking), nén gzip/brotli | `sensitive-data-detection`, `response-mask`, `json-filter`, `compression-gzip` |
| **`7. log`** | Sau khi client nhận response | Ghi metrics, đẩy trace span, audit log, bảo đảm non-blocking hoàn toàn | `access-log`, `audit-log`, `prometheus`, `datadog`, `opentelemetry`, `loki-logger` |

---

### 3.1. Phân Định Luồng Header: Inbound Request Headers vs Outbound Response Headers

Một điểm cốt lõi trong kiến trúc Gateway là **Headers được xử lý ở 3 thời điểm hoàn toàn khác nhau** tùy thuộc vào chiều dữ liệu và ngữ cảnh bảo mật:

```
CLIENT REQUEST
     │
     ▼
[ Phase 2: REWRITE ]  ──────────> Xử lý Inbound Client Headers:
                                  • Chuẩn hóa, lọc bỏ headers độc hại/giả mạo (Header Sanitization).
                                  • Match Headers (ví dụ: X-API-Version) để rewrite path/URI.
                                  • Plugin: uri-rewrite, request-query-transform.
     │
     ▼
[ Phase 3: ACCESS ]   ──────────> Trọng tài bảo mật:
                                  • Xác thực Bearer Token, API Key.
                                  • Giải mã danh tính người dùng (Claims: user_id, roles, scopes).
     │
     ▼
[ Phase 4: BEFORE-UPSTREAM ] ───> Gắn Inbound Backend Identity Headers (Trust Zone):
                                  • Bơm headers danh tính an toàn: X-Consumer-ID, X-User-Role.
                                  • Bơm chữ ký bảo mật: X-Signature, AWS SigV4.
                                  • Bơm Client Cert Fingerprint khi dùng mTLS.
                                  • Plugin: request-header-transform, request-signature.
     │
     ▼
[ BACKEND UPSTREAM ]
     │
     ▼
[ Phase 5: HEADER-FILTER ] ────> Xử lý Outbound Response Headers (Trả về cho Client):
                                  • Lắng nghe headers từ backend trả về.
                                  • Xóa bỏ các headers nhạy cảm của backend (Server: nginx, X-Powered-By).
                                  • Thêm headers bảo mật trình duyệt (CORS, HSTS, CSP, X-Frame-Options).
                                  • Plugin: response-header-transform, cors.
     │
     ▼
CLIENT RECEIVES RESPONSE
```

#### Ma trận so sánh Request Headers vs Response Headers:

| Tiêu chí | Inbound Request Headers (Phase 2 & 4) | Outbound Response Headers (Phase 5) |
| :--- | :--- | :--- |
| **Thời điểm** | Trước khi chuyển request đến Backend Upstream | Sau khi Backend Upstream trả response header về |
| **Mục đích** | Bóc tách ngữ cảnh client, định tuyến, bảo mật danh tính nội bộ | Bảo vệ client, tuân thủ chính sách trình duyệt (CORS/HSTS), giấu thông tin backend |
| **Plugin phụ trách** | `uri-rewrite`, `request-header-transform`, `request-signature` | `response-header-transform`, `cors` |
| **Ví dụ hành động** | `set_header("X-Consumer-ID", user.id)`<br>`match_header("X-API-Version")` | `add_header("Access-Control-Allow-Origin", "*")`<br>`remove_header("Server")` |

---

### 3.2. Header-Based Matching & Dynamic Path Rewriting (Nâng Cao)

#### Câu hỏi nghiệp vụ:
> *"Sau này có thể làm kiểu match Header của client để rewrite path đến backend được không?"*

**Câu trả lời: HOÀN TOÀN ĐƯỢC VÀ ĐÂY LÀ TÍNH NĂNG TẤT YẾU CỦA API GATEWAY HIỆN ĐẠI.**

Tính năng này cho phép Gateway kiểm tra các Header của request đến (ví dụ: `X-API-Version`, `X-Client-Type`, `X-Tenant-ID`, `Accept`) và tự động **viết lại URI / Path** trước khi chuyển đến upstream backend mà không cần client phải thay đổi URL gọi đến.

#### 1. Các Use Case Thực Tế Tiêu Biểu:

* **API Versioning qua Header:**
  * Client gọi: `POST https://api.aurora.io/checkout` với header `X-API-Version: 2`
  * Gateway nhận diện header và rewrite thành: `POST /v2/checkout` gửi tới backend.
  * Nếu client không truyền header hoặc truyền `X-API-Version: 1`: Gateway giữ nguyên hoặc rewrite thành: `POST /v1/checkout`.

* **Canary / Feature Flag / Beta Testing:**
  * Client nội bộ hoặc Beta tester gửi header `X-Canary: true` hoặc `X-Feature-Gate: new-checkout`
  * Gateway match header và rewrite path sang: `/canary-checkout` trên cùng một cụm backend.

* **Client Device Differentiation (Mobile vs Desktop):**
  * Mobile App gửi `X-Client-Device: mobile` $\rightarrow$ Gateway rewrite `/products` sang `/mobile/products` để backend trả payload tinh gọn hơn.

* **Multi-tenant / Legacy System Adapter:**
  * Client gửi `X-Tenant-ID: acme` $\rightarrow$ Gateway rewrite `/api/orders` thành `/tenants/acme/orders`.

#### 2. Vị Trí Thực Thi Trong Vòng Đời:
Logic này nằm hoàn toàn ở **Phase 2 (`rewrite`)**, trước khi request đi qua lớp kiểm tra bảo mật `access` và trước khi gửi sang upstream.

#### 3. Thiết Kế Cấu Hình Trong Route Plugin (`uri-rewrite`):

Trên Control Plane, cấu hình này được thể hiện gọn gàng dưới dạng mảng `rules` trong plugin `uri-rewrite`:

```json
{
  "id": "route_checkout",
  "path": "/checkout",
  "upstream_name": "payment_backend",
  "plugins": {
    "uri-rewrite": {
      "rules": [
        {
          "description": "Route v2 API based on header",
          "match": {
            "headers": {
              "X-API-Version": { "exact": "2" }
            }
          },
          "action": {
            "rewrite_path": "/v2/checkout"
          }
        },
        {
          "description": "Route mobile requests",
          "match": {
            "headers": {
              "X-Client-Type": { "regex": "^mobile-(ios|android)$" }
            }
          },
          "action": {
            "rewrite_prefix": "/mobile"
          }
        }
      ]
    }
  }
}
```

#### 4. Cách Aurora Agent Render Vào NGINX:

Aurora Agent khi nhận snapshot sẽ biên dịch rule này sang NGINX directives hiệu năng cực cao:

```nginx
# Render bởi Aurora Agent trong location /checkout
location = /checkout {
    set $upstream_target_uri $uri;

    # Rule 1: Header X-API-Version == 2
    if ($http_x_api_version = "2") {
        set $upstream_target_uri "/v2/checkout";
    }

    # Rule 2: Header X-Client-Type match Regex mobile
    if ($http_x_client_type ~* "^mobile-(ios|android)$") {
        set $upstream_target_uri "/mobile$uri";
    }

    proxy_pass http://payment_backend$upstream_target_uri;
}
```

*(Hoặc sử dụng NGINX Lua `rewrite_by_lua_block` qua hàm `ngx.req.set_uri(...)` để xử lý các logic phức tạp mà không bị hạn chế bởi cơ chế `if` của Nginx).*

---

## 4. Mô Hình Dữ Liệu: Route & Execution Plan

Mỗi bản ghi Route tuân thủ nguyên tắc **Flat Entity (1 Route $\rightarrow$ 1 Upstream)** và mang theo một **Execution Plan** được biên dịch sẵn:

### A. Cấu trúc Route Thực Thể (Database & API)
```json
{
  "id": "route_payment_checkout",
  "name": "Payment Checkout API",
  "host": "api.aurora.io",
  "path": "/api/v1/checkout",
  "upstream_name": "upstream_payment_cluster",
  "enabled": true,
  "strip_path": false,
  "websocket": false,
  "priority": 100,
  "plugins": {
    "request-id": { "header_name": "X-Request-ID" },
    "jwt-auth": { "secret_key": "secret", "issuer": "aurora-auth" },
    "rate-limit": { "rate": 50, "burst": 100, "period_secs": 1 },
    "sqli-protection": { "sensitivity": "high", "action": "block" },
    "cors": { "allow_origins": ["https://checkout.aurora.io"] },
    "response-mask": { "mask_credit_cards": true },
    "prometheus": { "enabled": true }
  }
}
```

### B. Pre-compiled Execution Plan (Dành cho Data Plane)
Khi compile, Control Plane / Agent sẽ sắp xếp các plugin trên vào đúng 7 phase:
```yaml
route_id: "route_payment_checkout"
host: "api.aurora.io"
path: "/api/v1/checkout"
upstream: "upstream_payment_cluster"
execution_plan:
  phase_1_pre_routing:
    - plugin: "request-id"
  phase_2_rewrite: []
  phase_3_access:
    - plugin: "jwt-auth"
    - plugin: "rate-limit"
    - plugin: "sqli-protection"
  phase_4_before_upstream: []
  phase_5_header_filter:
    - plugin: "cors"
  phase_6_body_filter:
    - plugin: "response-mask"
  phase_7_log:
    - plugin: "prometheus"
```

---

## 5. Thiết Kế Trực Quan Hóa (Visual Route Pipeline UI)

Mô hình 7 Phase này chính là cơ sở dữ liệu để chúng ta xây dựng **Visual Route Inspector** trên giao diện Console:

### Giao diện Visual Pipeline của một Route:
```
[ Inbound: api.aurora.io/api/v1/checkout ]
                      │
                      ▼
 ┌───────────────────────────────────────────────────────────┐
 │ 1. PRE-ROUTING                                            │
 │    ● request-id (X-Request-ID)                            │
 └────────────────────────────┬──────────────────────────────┘
                              │
 ┌────────────────────────────┴──────────────────────────────┐
 │ 2. REWRITE                                                │
 │    (Passthrough: /api/v1/checkout)                        │
 └────────────────────────────┬──────────────────────────────┘
                              │
 ┌────────────────────────────┴──────────────────────────────┐
 │ 3. ACCESS (Security & Rate Limit)                         │
 │    ● jwt-auth [Verify Token & Issuer]                     │
 │    ● rate-limit [50 req/s, burst 100]                     │
 │    ● sqli-protection [Detect SQLi Injection -> 403]       │
 └────────────────────────────┬──────────────────────────────┘
                              │
 ┌────────────────────────────┴──────────────────────────────┐
 │ 4. BEFORE-UPSTREAM                                        │
 │    (Forward to upstream_payment_cluster)                  │
 └────────────────────────────┬──────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │ Upstream: 3 Nodes Active  │
                │ 10.0.1.21:8080 (Weight 5) │
                │ 10.0.1.22:8080 (Weight 5) │
                └─────────────┬─────────────┘
                              │
 ┌────────────────────────────┴──────────────────────────────┐
 │ 5. HEADER-FILTER                                          │
 │    ● cors [Origin: https://checkout.aurora.io]            │
 └────────────────────────────┬──────────────────────────────┘
                              │
 ┌────────────────────────────┴──────────────────────────────┐
 │ 6. BODY-FILTER                                            │
 │    ● response-mask [Mask Credit Cards: ****-****-****-1234│
 └────────────────────────────┬──────────────────────────────┘
                              │
 ┌────────────────────────────┴──────────────────────────────┐
 │ 7. LOG                                                    │
 │    ● prometheus [Export Latency, Status & Counter]        │
 └───────────────────────────────────────────────────────────┘
```

### Các trạng thái trực quan trên UI sau này:
* **Active Node (Xanh lá):** Plugin đang chạy và bảo vệ route.
* **Bypass / Passthrough (Xám nhạt):** Phase không có plugin nào được gắn.
* **Blocked / Intercepted (Đỏ):** Hiển thị điểm ngắt request khi có lỗi (ví dụ WAF phát hiện SQLi chặn tại Phase 3).
* **Latency breakdown (ms):** Hiển thị thời gian tiêu tốn trên từng phase khi soi log chi tiết của một request.

---

## 6. Kết luận & Các bước tiếp theo

1. Mọi thiết kế từ backend, schema cơ sở dữ liệu, model Rust cho đến UI từ nay sẽ tuân theo cấu trúc **7 Request Phases** này.
2. Việc tạo Route mới sẽ cho phép người dùng click chọn trực tiếp các Plugin muốn kích hoạt và xem ngay sơ đồ **Visual Pipeline** trực quan tương ứng.
