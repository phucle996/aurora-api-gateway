# Threat model ban đầu

Tài sản: backend availability, request confidentiality, policy integrity, operator
credentials và audit trail. Attacker có thể gửi HTTP tùy ý, làm đầy event stream,
tạo high-cardinality fields hoặc thử bypass parser. Compromised node/controller
là ranh giới khác; WAF không bảo vệ được engine khỏi root trên cùng host.

| Ranh giới / nguy cơ | Biện pháp thiết kế | Bằng chứng cần có |
| --- | --- | --- |
| Internet → NGINX: body lớn, encoding mơ hồ | Input budgets, canonicalization rõ, không parse framing lần hai | Parser differential corpus, HTTP/1.1 + HTTP/2 integration |
| NGINX → Rust: pointer/lifetime sai | Borrow contract, opaque handles, ABI version | C harness, sanitizers, disconnect/reload stress |
| Rules → worker: regex/transform DoS | Compile trước, giới hạn rule/pattern/input/work | Adversarial benchmarks, fuzzing |
| Operator → API: chiếm quyền publish | Auth, RBAC, revision check, audit, CSRF protection | Authorization matrix tests |
| Controller → agent: snapshot giả/replay | TLS identity, signed artifacts, revision/rollback authorization | Tamper/replay/rotation tests |
| Events → UI: secret leak/stored XSS | Redact trước emit, escape render, access control | Redaction fixtures, malicious log rendering |
| Collector ngừng/queue đầy | Bounded buffer, drop counters | Load test collector outage |
| IP header giả | Chỉ trust proxy CIDR cấu hình rõ | Spoofed X-Forwarded-For fixtures |

## Chính sách dữ liệu

Không log Authorization, Cookie, tokens hoặc full request body mặc định. Query/path
có thể chứa bí mật: dùng omission/redaction và length cap. Sample capture cần opt-in,
TTL, quyền riêng và audit. Dữ liệu dùng benchmark phải synthetic hoặc đã sanitize.

## Các giới hạn còn lại

Custom WAF có thể có false positive/false negative; audit mode và rule exclusions là
workflow chính thức. Process crash vẫn có thể ảnh hưởng worker dù Rust memory-safe;
C/FFI cần review riêng. WAF không thay thế fix lỗ hổng ứng dụng, TLS configuration,
network filtering hay volumetric DDoS service. Parser differences giữa NGINX/backend
phải được kiểm thử trên deployment đích.

