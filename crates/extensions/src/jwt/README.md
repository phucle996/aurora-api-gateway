# JWT Authentication Extension (`builtin/jwt-authentication`)

<p align="center">
  <strong>Phân hệ xác thực JSON Web Token, trích xuất Claims & thu hồi tức thời cấp vi kiến trúc (Sub-Microsecond, Zero-Allocation, Distributed L2 Pre-Arming) cho Aurora API Gateway.</strong>
</p>

---

## 1. Tổng quan & Triết lý Thiết kế (Overview & Philosophy)

**`builtin/jwt-authentication`** là extension xác thực danh tính và trích xuất đặc quyền (Identity Authentication & Claim Forwarding Engine) gốc được biên dịch tĩnh trực tiếp vào lõi **Aurora API Gateway**. Extension được viết bằng **Rust**, tích hợp trực tiếp vào pha `NGX_HTTP_ACCESS_PHASE` của NGINX thông qua Foreign Function Interface (FFI) tầng C ABI, đảm bảo độ trễ xác thực sub-microsecond và hoàn toàn không sinh rác bộ nhớ (Zero Heap Allocation) trên đường dẫn xử lý lưu lượng (Hot Path).

### Các Invariant Kiến trúc Cốt lõi:
1. **Unified 4-Column Sheet Cache**:
   Thay thế toàn bộ mô hình Dual-HashMap truyền thống bằng một bảng phẳng duy nhất 4 cột liên tục (`expire_epoch_secs`, `status`, `jti_hash`, `forwarded_headers`) được bọc trong 64 Shards độc lập căn lề 64 bytes (`#[repr(align(64))]`).
2. **Single-Probe Resolution (~7-10ns Hot Path)**:
   Mọi request đến chỉ thực hiện **duy nhất 1 lần hash probe**. Nếu `status == 1`: chấp thuận ngay lập tức với forward headers đã render sẵn; nếu `status == 0`: từ chối ngay với HTTP 401 mà không tốn chu kỳ CPU nào cho giải mã mật mã.
3. **1-Chu kỳ Lật Bit Thu hồi tại chỗ (In-Place Bit Flip)**:
   Khi nhận lệnh thu hồi hoặc người dùng đăng xuất, hệ thống chỉ ghi đè bit `row.status = 0` bằng 1 lệnh `MOV` của CPU. Không xóa node, không cấp phát heap, không rehash bucket.
4. **Phân tầng L1 & L2 (Tách biệt Hot Path & Shadow Worker)**:
   * **L1 Sheet Cache (Traffic Worker)**: Vận hành 100% trong RAM của worker NGINX, tuyệt đối không mở socket kết nối Redis, 0 network I/O.
   * **L2 Redis Layer (Shadow Worker `aurora-shadow`)**: Chạy bất đồng bộ ngầm out-of-band trên Tokio runtime. Tự động nạp trước danh sách token bị hủy khi khởi động (Boot Sync) và lắng nghe sự kiện logout theo thời gian thực (Pub/Sub) trong < 1ms.
5. **Version Gated Periodic Reconciliation (Zero Desync)**:
   Mỗi 30s, Shadow Worker gửi đúng 1 lệnh `GET aurora:jwt:revocation_version` ($O(1)$, ~8 bytes). Nếu version không đổi, kết thúc ngay lập tức (chi phí = 0). Nếu phát hiện lệch version, tự động phân trang qua `SSCAN COUNT 100` để quét bù mà không bao giờ làm nghẽn Redis hay gián đoạn các luồng Traffic Worker.
6. **Zero-Allocation Hot Path**:
   Đạt chuẩn `0.000` allocations trên mỗi request hit thông qua bộ đệm ngăn xếp (Stack Buffers), băm trực tiếp mảng byte (`hash_token_bytes`), trì hoãn `from_utf8`, và tái sử dụng singleton `empty_forwarded_headers()`.
7. **Strict Token Source Isolation**:
   Phân tách tuyệt đối giữa `header` và `cookie`. Không cho phép fallback ngầm giữa các nguồn nhằm triệt tiêu các vector tấn công Credential Smuggling.

---

## 2. Đặc tả Tham số Cấu hình (Declarative Configuration Schema)

Mỗi origin đại diện cho một chính sách xác thực áp dụng cho một hoặc nhiều upstream services. Cấu hình được nạp dưới dạng JSON declarative:

| Tham số (Field) | Kiểu dữ liệu | Bắt buộc | Ngưỡng cho phép / Định dạng | Giá trị Khuyến nghị | Ý nghĩa & Invariant hệ thống |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **`id`** | `string` | **Có** | Tối đa 128 ký tự, không rỗng | `"shop-auth-prod"` | Định danh duy nhất của origin policy. |
| **`host`** / `origin` | `string` | **Có** | FQDN hoặc Wildcard (`api.domain.com`, `*.domain.com`, `*`) | `"api.domain.com"` | Tên miền áp dụng chính sách. Hỗ trợ tìm kiếm theo Radix Tree. |
| **`path_prefix`** | `string` | **Có** | Bắt đầu bằng `/`, tối đa 1024 bytes | `"/api/v1"` (hoặc `"/"`) | Tiền tố đường dẫn URI bắt buộc áp dụng kiểm tra JWT. |
| **`algorithm`** | `string` | **Có** | `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `EdDSA` | `"RS256"` hoặc `"HS256"` | Thuật toán mật mã chữ ký. Hệ thống từ chối fallback ngầm. |
| **`token_source`** | `string` \| `object` | **Có** | `"header"` hoặc `"cookie"` | `"header"` | Vị trí trích xuất token. Tuyệt đối không fallback sang vị trí khác. |
| **`header_name`** | `string` | Có (nếu header) | Tên HTTP header chuẩn | `"Authorization"` | Tên header chứa JWT khi `token_source` là `"header"`. |
| **`token_prefix`** | `string` | Không | Chuỗi tiền tố (ví dụ: `"Bearer "`) | `"Bearer "` | Tiền tố cần loại bỏ trước khi băm và xác thực token. |
| **`cookie_name`** | `string` | Có (nếu cookie) | Tên Cookie chuẩn RFC 6265 | `"access_token"` | Tên cookie chứa JWT khi `token_source` là `"cookie"`. |
| **`public_key_pem`** | `string` | Có (Asym) | Khóa công khai định dạng PEM RFC 7468 | *(PEM public key)* | Khóa công khai cho các thuật toán bất đối xứng (`RS*`, `ES*`, `EdDSA`). |
| **`secret`** | `string` | Có (Sym) | Chuỗi bí mật đối xứng độ hỗn loạn cao | *(Secret $\ge$ 256 bits)* | Chuỗi bí mật chia sẻ cho các thuật toán đối xứng (`HS*`). |
| **`keys`** | `array` | Không | Mảng `KeyInput` tối đa 8 phần tử | `[]` | Vòng quay khóa (Key Ring) hỗ trợ xoay khóa zero-downtime theo `kid`. |
| **`require_exp`** | `boolean` | Không | `true` \| `false` | `true` | Bắt buộc token phải có claim `exp`. Từ chối token vô thời hạn. |
| **`validate_exp`** | `boolean` | Không | `true` \| `false` | `true` | Kiểm tra thời hạn hết hạn của token so với wall-clock. |
| **`validate_nbf`** | `boolean` | Không | `true` \| `false` | `false` | Kiểm tra claim `nbf` (Not Before) để chống sử dụng sớm token. |
| **`clock_skew_secs`**| `integer` | Không | `0` đến `300` giây | `60` | Độ lệch đồng hồ chấp nhận được để bù đắp sai số NTP giữa các máy chủ. |
| **`issuer`** | `string` | Không | Chuỗi URL / định danh issuer | `"https://auth.domain.com"` | Khớp chính xác claim `iss`. Từ chối token phát hành sai nguồn. |
| **`audience`** | `string` | Không | Chuỗi định danh audience | `"https://api.domain.com"` | Khớp chính xác claim `aud` (hỗ trợ cả chuỗi và mảng chuỗi). |
| **`exclude_paths`** | `list<string>`| Không | Tối đa 32 đường dẫn, bắt đầu bằng `/` | `["/api/healthz", "/api/login"]` | Danh sách đường dẫn được bypass mà không cần token. |
| **`claim_rules`** | `array` | Không | Tối đa 32 quy tắc trích xuất | `[...]` | Bảng ánh xạ claim JSON thành HTTP headers chuyển tiếp lên backend. |
| **`cache`** | `object` | Không | Cấu hình L1 Sheet Cache | `{ "enabled": true }` | Tùy biến shard count, capacity, và thời gian TTL của L1 cache. |
| **`redis`** | `object` | Không | Cấu hình L2 Distributed Layer | `{}` (hoặc `{ "endpoint": ... }`) | Đồng bộ phân tán token bị hủy. Bỏ trống hoặc `{}` để chạy thuần Local Mode. |

---

## 3. Mẫu Cấu hình Chuẩn Mực (Production JSON Cookbooks)

### 3.1 Cấu hình Phân tán Production (L1 Sheet Cache + L2 Redis Pre-Arming)
Khuyến nghị cho hạ tầng microservices quy mô lớn với nhiều node gateway và backend logout tập trung:

```json
{
  "schema_version": 1,
  "generation": 100,
  "origins": [
    {
      "id": "ecommerce-api-prod",
      "host": "api.shop.com",
      "path_prefix": "/api/v1",
      "algorithm": "RS256",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0zVSlNUkbhLP4B20mKBY...\n-----END PUBLIC KEY-----\n",
      "token_source": "header",
      "header_name": "Authorization",
      "token_prefix": "Bearer ",
      "require_exp": true,
      "validate_exp": true,
      "clock_skew_secs": 60,
      "issuer": "https://auth.shop.com",
      "audience": "https://api.shop.com",
      "exclude_paths": [
        "/api/v1/healthz",
        "/api/v1/auth/login",
        "/api/v1/public/catalog"
      ],
      "claim_rules": [
        {
          "payload_key": "sub",
          "header_key": "X-User-Id",
          "values_match": "*",
          "required": true
        },
        {
          "payload_key": "user.tenant_id",
          "header_key": "X-Tenant-Id",
          "values_match": "^T-[0-9]{4,8}$",
          "required": true
        },
        {
          "payload_key": "roles",
          "header_key": "X-User-Roles",
          "values_match": "*",
          "required": false
        }
      ],
      "cache": {
        "enabled": true,
        "shards": 64,
        "max_entries_per_shard": 1024,
        "default_ttl_secs": 300,
        "negative_ttl_secs": 30
      },
      "redis": {
        "endpoint": "redis://172.16.0.5:6379",
        "timeout_ms": 50,
        "pool_size": 8
      }
    }
  ]
}
```

### 3.2 Cấu hình Thuần Local Mode (Pure Local Mode L1, Không dùng Redis)
Khai báo `"redis": {}` rỗng để chạy thuần bộ nhớ in-memory 7ns mà không tạo bất kỳ kết nối mạng hay background worker nào:

```json
{
  "schema_version": 1,
  "generation": 101,
  "origins": [
    {
      "id": "internal-service-local",
      "host": "internal.service.local",
      "path_prefix": "/api",
      "algorithm": "HS256",
      "secret": "super-secure-high-entropy-symmetric-secret-key-256b!",
      "token_source": "header",
      "header_name": "Authorization",
      "token_prefix": "Bearer ",
      "require_exp": true,
      "validate_exp": true,
      "cache": {
        "enabled": true
      },
      "redis": {}
    }
  ]
}
```

### 3.3 Cấu hình Xác thực bằng Cookie RFC 6265 (Zero-Copy Cookie Parser)
Dành cho ứng dụng Web / Single Page Application (SPA) truyền access token an toàn qua `HttpOnly` Cookie:

```json
{
  "schema_version": 1,
  "generation": 102,
  "origins": [
    {
      "id": "web-portal-cookie",
      "host": "portal.company.com",
      "path_prefix": "/dashboard",
      "algorithm": "ES256",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEtSfg96VSp3mLb/WguwsaTO4DKgGw...\n-----END PUBLIC KEY-----\n",
      "token_source": "cookie",
      "cookie_name": "session_token",
      "token_prefix": "",
      "require_exp": true,
      "validate_exp": true
    }
  ]
}
```

---

## 4. Cơ chế Hoạt động & Ma trận Tính năng

```
+------------------------------------------------------------------------------------+
|                                 AURORA JWT ENGINE                                  |
+------------------------------------------------------------------------------------+
| [1. Radix Match]   -> Host & Path lookup in O(K) time                              |
| [2. Exclude Match] -> Fast bypass for health checks (1-cycle SWAR LcpGuard)         |
| [3. Token Extract] -> Zero-copy Header or RFC 6265 Cookie slice                    |
| [4. Hot Path L1]   -> FxHash bytes -> Single-probe sheet lookup (7-10 ns)          |
|                       - status == 0 -> 401 Unauthorized immediately               |
|                       - status == 1 -> Inject pre-formatted headers & Proxy (Allow)|
| [5. Cache Miss]    -> SIMD memchr_iter dot hunting + Hardware verify               |
|                       - HS256: Intel SHA-NI / AMD SHA Extensions                   |
|                       - RS256: RSA-PKCS#1 v1.5 with Ring engine                    |
|                       - ES256 / EdDSA: High-throughput elliptic curve              |
| [6. Claims & Store]-> Traversal, Regex validation -> In-place insert to L1         |
+------------------------------------------------------------------------------------+
                               ▲
                               │ Out-of-band Pre-Arming (Shadow Worker)
+------------------------------┴-----------------------------------------------------+
| [L2 Redis Layer]   -> Set aurora:jwt:revoked_set & Pub/Sub aurora:jwt:revocations  |
+------------------------------------------------------------------------------------+
```

### Ma trận Tính năng So sánh (Feature Matrix)

| Khả năng | Aurora Gateway (`builtin/jwt`) | Envoy Proxy (`jwt_authn`) | Kong Gateway (`jwt`) |
| :--- | :---: | :---: | :---: |
| **Kiến trúc Cache** | **Unified 4-Column Sheet (Single-Probe)** | Dual LruCache / Filter State | `lua_shared_dict` |
| **Độ trễ Cache Hit** | **7 - 10 ns** (In-process Sheet) | 150 - 300 ns | 1.2 - 2.5 µs (Lua/C border) |
| **Đăng xuất / Thu hồi**| **In-place bit flip (`status = 0`)** | Trục xuất hoặc đợi TTL | Xóa key và lock shm |
| **Tầng phân tán L2** | **Shadow Pre-Arming (0 Hot Path I/O)** | Khó tích hợp ngoài filter | Polling Redis trên worker |
| **Độ trễ Edge Rejection** | **< 1 µs** (108.5k+ RPS) | 3.8 ms (43.4k RPS) | 1.1 ms (107k RPS) |
| **Phân tích Cookie** | **Zero-Copy RFC 6265 Scanner** | Chuỗi con C++ copy | Lua Regex (heap allocation) |
| **Xoay khóa (Key Ring)** | **O(1) Hash Map theo `kid`** | JWKS Remote / Static | Static Consumer Credential |
| **Cấp phát bộ nhớ Hot Path** | **0.000 allocations** | Cấp phát đối tượng C++ | Thu gom rác LuaJIT GC |

---

## 5. Chỉ số Đo lường & Mục tiêu Cam kết (SLO Metrics)

Khi triển khai trên môi trường sản xuất chuẩn (4 vCPU, 16GB RAM):
- **Tỷ lệ trúng Cache (Target Cache Hit Ratio)**: $\ge 98.5\%$ đối với traffic định danh thông thường.
- **Độ trễ Hot-Path P99 (L1 Hit)**: $\le 20 \text{ ns}$ (đo tại tầng Rust FFI Engine).
- **Độ trễ Edge Rejection P50**: $\le 0.90 \text{ ms}$ (toàn chu trình HTTP socket to socket).
- **Độ trễ Đồng bộ Thu hồi L2 (Pub/Sub Sync Latency)**: $\le 1.0 \text{ ms}$ từ khi backend publish đến khi L1 Sheet Cache chuyển `status = 0`.
- **Rò rỉ Bộ nhớ (Memory Leak Drift)**: **0.00 bytes** sau hàng chục triệu chu kỳ request.
