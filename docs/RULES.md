# Rule language v1 — đề xuất

Subset exact-path hiện hỗ trợ schema v2 allow/log/block và management API:
[RULES_BACKEND.md](RULES_BACKEND.md). Không nhầm subset này với full language dưới đây.

Tài liệu này là full rule language dự kiến. Runtime bootstrap hiện dùng JSON
exact-path subset đã implement, mô tả ở [RUNTIME.md](RUNTIME.md); không nhận YAML này.

Ưu tiên YAML/JSON declarative, chưa làm DSL parser riêng. File
[policy.yaml](../examples/policy.yaml) là ví dụ thiết kế, chưa có parser/schema executable.

Policy có `schema_version`, ID, mode, limits, threshold và ordered rules.
Rule có ID duy nhất, enabled, targets, operator, transforms, action, score,
severity và tags. Các target và operator phải nằm trong enum versioned.

## Semantics cần đóng băng ở Stage 1

- Rule match trên bất kỳ target được khai báo; mỗi rule chỉ cộng score một lần/request.
- Operator đầu tiên: exact, prefix, contains, bounded regex, CIDR.
- Transform theo thứ tự khai báo: URL decode một lần hoặc lowercase ASCII.
  Không decode lặp vô hạn; raw bytes và normalized view được phân biệt.
- `score` tích lũy; `block` là quyết định terminal; `log` ghi match không block.
- Sau evaluation, score >= block threshold → block; dưới ngưỡng → allow.
- `detection_only` giữ would-be decision trong event, action thực tế là allow.
- Allowlist và exclusions phải có scope host/path/rule và thứ tự rõ; generic
  terminal allow chưa vào schema v1 để tránh bypass toàn policy ngoài ý muốn.
- Mode off, errors, unsupported body và size exceeded có quyết định riêng,
  không bị coi là request sạch. Code lỗi dự kiến 413 cho body quá lớn, 403 cho
  policy block, 503 cho engine failure; cần kiểm thử tương tác với NGINX.

Compiler reject ID trùng, version lạ, target/operator không hỗ trợ, threshold
không hợp lệ, regex vượt budget và score có thể overflow. Runtime bounded arithmetic.
Regex dùng engine có độ phức tạp được kiểm soát, có giới hạn pattern/input/rule count;
không mặc định chấp nhận PCRE backreferences.

SQLi/XSS rules ban đầu là corpus thử nghiệm, không cam kết đủ bảo vệ. Stage 1 đánh
giá detector/parser chuyên dụng và package reuse; mỗi rule cần benign/attack fixtures,
explanation và exclusion test.
