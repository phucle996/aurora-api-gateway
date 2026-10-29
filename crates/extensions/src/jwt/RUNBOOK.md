# Runbook & Configuration Guide: `jwt` Extension

<p align="center">
  <strong>Cẩm nang chuẩn hóa cấu hình bắt buộc, quy chuẩn giao thức phân tán L2 Redis, quy trình vận hành Day-2 và quy trình ứng phó sự cố (Incident Troubleshooting SOP) cho phân hệ JWT Authentication.</strong>
</p>

---

## 1. Quy chuẩn Cấu hình Bắt buộc (Mandatory Configuration Specification)

Theo kiến trúc chuẩn hóa của Aurora Gateway, chính sách JWT được nạp dưới dạng declarative JSON snapshot. Mỗi origin đại diện cho một upstream service và phải tuân thủ nghiêm ngặt các điều kiện biên của hệ thống:

### 1.1 Bảng Đặc tả Tham số Cấu hình (Configuration Schema)

| Trường (Field) | Kiểu dữ liệu | Trạng thái | Ngưỡng cho phép / Định dạng | Giá trị Khuyến nghị | Mô tả chi tiết & Invariant bắt buộc |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **`id`** | `string` | **Bắt buộc** | `1` đến `128` ký tự, không rỗng, không chứa khoảng trắng | `"auth-shop-prod"` | Định danh duy nhất của origin rule trong snapshot. Trùng lặp `id` sẽ bị từ chối nạp cấu hình. |
| **`host`** / `origin` | `string` | **Bắt buộc** | FQDN hoặc Wildcard (`api.domain.com`, `*.domain.com`, `*`), tối đa 253 ký tự | `"api.domain.com"` | Tên miền áp dụng. Phải là domain chữ thường hợp lệ chuẩn RFC 1035. |
| **`path_prefix`** | `string` | **Bắt buộc** | Bắt đầu bằng `/`, tối đa 1024 ký tự, không chứa `//`, `.` hoặc `..` | `"/api/v1"` (hoặc `"/"`) | Tiền tố đường dẫn URI áp dụng kiểm tra JWT. |
| **`algorithm`** | `string` | **Bắt buộc** | `HS256`, `HS384`, `HS512`, `RS256`, `RS384`, `RS512`, `ES256`, `ES384`, `EdDSA` | `"RS256"` hoặc `"HS256"` | Thuật toán mật mã chữ ký. Gateway **tuyệt đối không đoán** hoặc cho phép `none`. |
| **`token_source`** | `string` | **Bắt buộc** | `"header"` hoặc `"cookie"` | `"header"` | Vị trí trích xuất token. Enforce strictly non-fallback. |
| **`header_name`** | `string` | Bắt buộc (Header)| Tối đa 64 ký tự, chỉ chứa `A-Z, a-z, 0-9, -, _` | `"Authorization"` | Tên HTTP header chứa JWT khi `token_source: "header"`. |
| **`token_prefix`** | `string` | Tùy chọn | Tối đa 64 ký tự | `"Bearer "` | Tiền tố cần bóc tách trước khi lấy token. Để chuỗi rỗng `""` nếu không có tiền tố. |
| **`cookie_name`** | `string` | Bắt buộc (Cookie)| Tối đa 64 ký tự, chỉ chứa `A-Z, a-z, 0-9, -, _` | `"access_token"` | Tên Cookie chứa JWT khi `token_source: "cookie"`. |
| **`public_key_pem`** | `string` | Bắt buộc (Asym) | Chuẩn RFC 7468 PEM, tối đa 8,192 ký tự | *(Public Key PEM)* | Khóa công khai cho các thuật toán bất đối xứng. Bắt buộc bắt đầu bằng `-----BEGIN`. |
| **`secret`** | `string` | Bắt buộc (Sym)  | Chuỗi bí mật đối xứng, độ dài `1` đến `4096` bytes | *(Entropy $\ge$ 256 bits)* | Chuỗi bí mật dùng cho các thuật toán `HS256`, `HS384`, `HS512`. |
| **`require_exp`** | `boolean` | Tùy chọn | `true` \| `false` | **`true`** | Bắt buộc token phải có claim `exp`. Từ chối token vô thời hạn để đảm bảo an ninh. |
| **`validate_exp`** | `boolean` | Tùy chọn | `true` \| `false` | **`true`** | Bật xác thực hạn sử dụng của token. |
| **`validate_nbf`** | `boolean` | Tùy chọn | `true` \| `false` | `false` | Kiểm tra claim `nbf` (Not Before). |
| **`clock_skew_secs`**| `integer` | Tùy chọn | `0` đến `300` giây | `60` | Độ lệch đồng hồ chấp nhận được để bù sai số NTP giữa các cụm server. |
| **`exclude_paths`** | `array[string]`| Tùy chọn | Tối đa 32 đường dẫn, mỗi đường dẫn bắt đầu bằng `/` | `["/api/v1/healthz"]` | Danh sách các đường dẫn được bypass mà không cần token xác thực. |
| **`claim_rules`** | `array` | Tùy chọn | Tối đa 32 phần tử | `[...]` | Bảng quy tắc trích xuất claim và chuyển tiếp header lên upstream backend. |
| **`cache`** | `object` | Tùy chọn | Cấu hình L1 Sheet Cache | `{ "enabled": true }` | Cấu hình tuning Shards và TTL của bộ nhớ in-process. |
| **`redis`** | `object` | Tùy chọn | Cấu hình L2 Distributed Layer | `{}` (hoặc `{ "endpoint": ... }`) | Cấu hình kết nối Redis L2 để pre-arm và thu hồi tức thời. Khai báo `{}` để chạy thuần Local Mode. |

---

### 1.2 Mẫu Cấu hình Declarative JSON Chuẩn mực

#### Mẫu 1: Cấu hình Phân tán Production (L1 Sheet Cache + L2 Redis Pre-Arming)
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
        "/api/v1/auth/login"
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

#### Mẫu 2: Cấu hình Thuần Local Mode (Pure Local Mode L1 - Không Cần Redis)
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

---

## 2. Quy chuẩn Giao thức Tích hợp Backend $\leftrightarrow$ Redis (L2 Protocol Specification)

Để thu hồi token hoặc quản lý đăng xuất đồng bộ giữa Backend và Gateway, Backend cần tương tác với Redis theo đúng quy chuẩn 3 khóa chuẩn hóa:

```
+------------------------------------+-----------------------+-------------------------------------------------+
| Tên Khóa / Kênh (Key / Channel)    | Kiểu dữ liệu Redis    | Mục đích & Hành vi                              |
+------------------------------------+-----------------------+-------------------------------------------------+
| aurora:jwt:revocation_version      | String (Integer)      | Bộ đếm version tăng dần khi có bất kỳ thu hồi.  |
| aurora:jwt:revoked_set             | Set (Tập hợp)         | Danh sách bền vững các token/JTI bị thu hồi.    |
| aurora:jwt:revocations             | Pub/Sub Channel       | Kênh phát thanh sự kiện thu hồi theo thời gian  |
|                                    |                       | thực tới toàn bộ các Gateway nodes (< 1ms).     |
+------------------------------------+-----------------------+-------------------------------------------------+
```

### 2.1 Định dạng Payload Hợp lệ
* **Thu hồi theo JTI**: `jti:<unique_jti_string>` hoặc `jti:<unique_jti_string>:<expire_epoch>`
* **Thu hồi theo Raw Token**: `<raw_jwt_string>` hoặc `<raw_jwt_string>:<expire_epoch>`
* **Thu hồi theo Token Hash**: `<u64_numeric_hash>` hoặc `<u64_numeric_hash>:<expire_epoch>`
* **Gắn thẻ Version (Khuyên dùng)**: Thêm hậu tố `#<version>` (ví dụ: `jti:usr-session-99:1730000000#42`)

---

### 2.2 Mã Mẫu Tích hợp Backend (Backend Integration Code)

#### 🔹 Golang (Chuẩn Production Khuyến nghị):
```go
package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type TokenRevoker struct {
	rdb *redis.Client
}

func NewTokenRevoker(rdb *redis.Client) *TokenRevoker {
	return &TokenRevoker{rdb: rdb}
}

// RevokeToken hủy bỏ phiên làm việc của người dùng bằng token hoặc JTI.
func (r *TokenRevoker) RevokeToken(ctx context.Context, target string, expEpoch uint64) error {
	pipe := r.rdb.Pipeline()

	// 1. Tăng version counter toàn cục
	incrCmd := pipe.Incr(ctx, "aurora:jwt:revocation_version")

	// 2. Thêm vào Set lưu trữ bền vững
	itemWithExp := fmt.Sprintf("%s:%d", target, expEpoch)
	pipe.SAdd(ctx, "aurora:jwt:revoked_set", itemWithExp)

	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("failed to write revocation to redis: %w", err)
	}

	newVersion := incrCmd.Val()

	// 3. Phát thanh Pub/Sub tới toàn bộ cụm Gateway Nodes
	pubPayload := fmt.Sprintf("%s#%d", itemWithExp, newVersion)
	return r.rdb.Publish(ctx, "aurora:jwt:revocations", pubPayload).Err()
}
```

#### 🔹 Node.js / TypeScript:
```typescript
import { createClient } from 'redis';

export class AuroraTokenRevoker {
  constructor(private redis: ReturnType<typeof createClient>) {}

  async revoke(target: string, expEpochSecs: number): Promise<void> {
    const multi = this.redis.multi();
    multi.incr('aurora:jwt:revocation_version');
    const itemWithExp = `${target}:${expEpochSecs}`;
    multi.sAdd('aurora:jwt:revoked_set', itemWithExp);

    const [newVersion] = await multi.exec();

    // Publish tới kênh realtime
    const pubPayload = `${itemWithExp}#${newVersion}`;
    await this.redis.publish('aurora:jwt:revocations', pubPayload);
  }
}
```

---

## 3. Quy trình Vận hành Day-2 (Operational Playbooks)

### 📘 Playbook 1: Người dùng Đăng xuất (Single User Logout)
* **Kịch bản**: Người dùng nhấn Đăng xuất trên ứng dụng Web/Mobile.
* **Hành động Backend**:
  ```bash
  # Lấy exp timestamp của token hiện tại (ví dụ: 1730000000)
  redis-cli INCR aurora:jwt:revocation_version
  redis-cli SADD aurora:jwt:revoked_set "jti:<jti_id>:1730000000"
  redis-cli PUBLISH aurora:jwt:revocations "jti:<jti_id>:1730000000#<version>"
  ```
* **Thời gian đáp ứng**: Toàn bộ các Gateway nodes chuyển trạng thái `status = 0` trên RAM trong **$< 1.0\text{ ms}$**.

---

### 📘 Playbook 2: Khóa Tài khoản Khẩn cấp (Emergency Account Revocation)
* **Kịch bản**: Tài khoản bị xâm phạm hoặc bị đình chỉ bởi quản trị viên (Admin Ban). Cần vô hiệu hóa mọi token đang lưu hành của tài khoản đó ngay lập tức.
* **Hành động Backend**:
  * Phát lệnh thu hồi toàn bộ token gắn liền với User ID đó:
  ```bash
  # Thu hồi theo JTI hoặc Token Hash
  redis-cli SADD aurora:jwt:revoked_set "jti:user-session-abc:1800000000"
  redis-cli INCR aurora:jwt:revocation_version
  redis-cli PUBLISH aurora:jwt:revocations "jti:user-session-abc#<version>"
  ```

---

### 📘 Playbook 3: Xoay Khóa Zero-Downtime khi Lộ Khóa (Key Rollover)
* **Kịch bản**: Khóa bí mật đối xứng `HS256` hoặc Private Key `RS256` bị rò rỉ, cần chuyển sang khóa mới mà không làm gián đoạn người dùng hiện hữu.
* **Quy trình Thực hiện**:
  1. Cấu hình mảng `keys` với khóa mới làm `is_primary: true`, giữ lại khóa cũ với `is_primary: false`:
  ```json
  "keys": [
    {
      "kid": "key-2026-v2",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\n<NEW_PUB_KEY>\n-----END PUBLIC KEY-----\n",
      "is_primary": true
    },
    {
      "kid": "key-2025-v1",
      "public_key_pem": "-----BEGIN PUBLIC KEY-----\n<OLD_PUB_KEY>\n-----END PUBLIC KEY-----\n",
      "is_primary": false
    }
  ]
  ```
  2. Nạp cấu hình mới qua Control Worker API.
  3. Cập nhật Identity Provider phát hành JWT mới với JOSE Header `{"kid": "key-2026-v2"}`.
  4. Sau khi toàn bộ token cũ hết hạn (theo TTL), xóa `key-2025-v1` khỏi mảng `keys`.

---

### 📘 Playbook 4: Xử lý Sự cố Redis Outage / Network Partition
* **Kịch bản**: Máy chủ Redis gặp sự cố, rớt mạng hoặc khởi động lại.
* **Hành vi Tự động của Gateway**:
  * **Hot Path NGINX hoàn toàn không bị ảnh hưởng**: NGINX Traffic Worker tiếp tục phục vụ khách hàng với độ trễ 7-10ns dựa trên bộ nhớ L1 Sheet Cache sẵn có.
  * **Shadow Worker tự động cách ly**: Bật cơ chế retry với exponential backoff (`1s`, `2s`, `4s`, `8s`, tối đa `15s`).
  * **Tự động phục hồi khi Redis online**: Ngay khi kết nối lại thành công, Shadow Worker tự động kích hoạt `reconcile_from_redis` qua `SSCAN COUNT 100`, quét bù toàn bộ token bị thu hồi trong lúc mất mạng, sau đó mở lại Pub/Sub listener.

---

### 📘 Playbook 5: Kích hoạt Quét bù Thủ công (Manual Force Resync)
* **Kịch bản**: Nghi ngờ có sự lệch phiên bản giữa Gateway và Redis sau một sự cố hạ tầng mạng phức tạp.
* **Hành động Vận hành**:
  1. Tăng version trên Redis:
  ```bash
  redis-cli INCR aurora:jwt:revocation_version
  ```
  2. Trong vòng tối đa 30 giây (hoặc ngay sau khi `PUBSUB_READ_TIMEOUT = 5s`), Shadow Worker của Gateway sẽ phát hiện `remote_version > local_version` và tự động kích hoạt tiến trình quét bù toàn diện qua `SSCAN`.

---

## 4. Giám sát & Ngưỡng Cảnh báo Sản xuất (Telemetry & Alerting)

### 4.1 Danh mục Chỉ số Prometheus Cần Giám sát

| Tên Chỉ số (Metric) | Loại | Ngưỡng Cảnh báo (Alert Threshold) | Ý nghĩa & Hành động Ứng phó |
| :--- | :---: | :---: | :--- |
| **`gateway_jwt_evaluations_total{status="unauthorized"}`** | Counter | Tăng vọt $\ge 300\%$ trong 1 phút | Bão từ chối 401: Kiểm tra xem có tấn công brute-force hoặc lộ khóa / hết hạn hàng loạt hay không. |
| **`gateway_jwt_cache_hit_ratio`** | Gauge | $\le 85.0\%$ trong 5 phút | Tỷ lệ trúng cache thấp: Kiểm tra xem cấu hình TTL của token có quá ngắn, hoặc dung lượng `shards`/`max_entries_per_shard` bị thiếu hụt. |
| **`gateway_jwt_redis_sync_errors_total`** | Counter | $\ge 5$ lỗi / phút | Shadow Worker không thể kết nối tới Redis: Kiểm tra Redis host, network firewall, TLS certs, hoặc pool exhaustion. |
| **`gateway_jwt_reconciliation_duration_seconds`** | Histogram | P99 $\ge 1.0\text{ s}$ | Thời gian quét bù quá lâu: Tập hợp Set trên Redis quá lớn, cần dọn dẹp các token đã quá hạn (`exp < now`). |

---

## 5. Quy trình Xử lý Sự cố Khẩn cấp (Incident Troubleshooting SOP)

### 🚨 Sự cố 1: Khách hàng phản ánh bị văng đăng xuất hàng loạt (401 Unauthorized Storm)
1. **Kiểm tra Logs NGINX**:
   ```bash
   tail -n 100 /var/log/aurora/access.log | grep " 401 "
   ```
2. **Kiểm tra Đồng hồ Hệ thống (NTP Drift)**:
   Nếu đồng hồ của Gateway chạy nhanh hơn Identity Provider, token vừa cấp sẽ bị coi là chưa có hiệu lực (`nbf`) hoặc hết hạn sớm (`exp`).
   ```bash
   timedatectl status
   # Nếu NTP lệch:
   sudo systemctl restart systemd-timesyncd
   ```
3. **Kiểm tra Tham số `clock_skew_secs`**:
   Tăng tạm thời `clock_skew_secs: 120` trong cấu hình để nới lỏng biên độ kiểm tra thời gian.

---

### 🚨 Sự cố 2: Đã gọi logout trên Backend nhưng token vẫn dùng được trên Gateway
1. **Kiểm tra Redis Set và Pub/Sub**:
   ```bash
   # Kiểm tra xem target đã vào Set chưa:
   redis-cli SMEMBERS aurora:jwt:revoked_set
   # Kiểm tra số lượng subscriber đang lắng nghe trên channel:
   redis-cli PUBSUB NUMSUB aurora:jwt:revocations
   ```
   * *Nếu `NUMSUB == 0`*: Gateway đang bị rớt kết nối Redis hoặc cấu hình `"redis"` bị sai/đang chạy Local Mode.
2. **Kiểm tra Kết nối Mạng từ Gateway tới Redis**:
   ```bash
   # Từ Gateway Node:
   nc -zv 172.16.0.5 6379
   ```
3. **Kích hoạt Quét bù Ngay lập tức**:
   ```bash
   redis-cli INCR aurora:jwt:revocation_version
   ```

---

### 🚨 Sự cố 3: Máy chủ Redis bị quá tải RAM do Set `aurora:jwt:revoked_set` quá lớn
1. **Nguyên nhân**: Backend chỉ thêm token vào Set khi logout nhưng không có job dọn dẹp các token đã hết hạn tự nhiên.
2. **Quy trình Khắc phục**:
   Chạy script dọn dẹp định kỳ (Cronjob) loại bỏ các phần tử có `expire_epoch < now`:
   ```bash
   # Script bảo trì Redis định kỳ (Chạy mỗi 1 giờ trên Backend Server)
   python3 -c '
   import redis, time
   r = redis.Redis(host="172.16.0.5", port=6379)
   now = int(time.time())
   for item in r.sscan_iter("aurora:jwt:revoked_set"):
       s = item.decode()
       if ":" in s:
           exp = int(s.split(":")[-1].split("#")[0])
           if exp > 0 and exp < now:
               r.srem("aurora:jwt:revoked_set", item)
   print("Dọn dẹp hoàn tất token hết hạn.")
   '
   ```
