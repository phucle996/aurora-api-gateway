# Rules backend — exact-path vertical slice

Implemented 2026-09-05: Go + SQLite + Rust compiler/runtime + C ABI v3 và local
activation CLI. Create/list/detail/history React đã nối API thật; xem
[Create Rule v2](CREATE_RULE.md). Edit extended definition/rollback vẫn là workflow riêng.

## Ownership và authority

Create/update/list/detail/history/stats/publish/release-detail có command, flat
projection và service/repository port riêng. Mutation không gọi read workflow.
SQLite là authority của management; worker dùng immutable snapshot đã nạp.

Schema v2 được giữ làm migration đã áp dụng; v3 bổ sung journal previous_payload
và immutable release guards. Nếu v2 đã có activation record thiếu recovery bytes,
startup từ chối upgrade thay vì xóa hoặc đoán state. Migration tests xác nhận
rules được giữ nguyên và journal chưa settle không bị mất.

Create dùng Idempotency-Key + request hash; cùng key khác input trả 409.
Update dùng expected_version; retry stale trả 409, không nhân đôi audit.
Update + immutable revision/audit nằm trong một transaction.
Publish freeze tập revisions tại lần reserve đầu tiên. Compiler lỗi không làm mất
payload; retry cùng key vẫn publish revisions cũ, không lấy những chỉnh sửa mới.
Release payload/membership bất biến, kèm digest; không serialize Rust memory.

## Runtime contract

Custom rule có name, description, group, action, severity, score, priority, path,
enabled. Target cố định normalized URI path, operator cố định exact.
Groups: custom, sqli, xss, traversal, bot, endpoint, authentication — chỉ là metadata,
không tự bật detector. Actions đang hỗ trợ allow/log/block. API/compiler reject
rate-limit và extended predicates tại runtime thay vì âm thầm bỏ qua. Create v2 cho
phép lưu extended definitions với runtime_ready=false và chặn publish khi enabled.

Thứ tự priority tăng dần, rồi numeric ID tăng dần. Log cộng score và tiếp tục;
allow/block terminal trong WAF scope hiện tại. Allow không bỏ qua access/auth module
khác hoặc authorization backend. Log không ép upstream trả 200. Score chỉ là tổng
đóng góp đến terminal match; chưa có threshold. Severity chỉ là metadata.

Limits: 1024 rules trong kho local; snapshot <=64 KiB; path <=8192 ASCII canonical;
score 0..1000; priority 0..1000000. Reject percent escapes, query/fragment, backslash,
controls, repeated slash và dot segments. Trùng path được xử lý theo thứ tự.

Rust xây bảng quyết định trước load, request chỉ immutable lookup, không allocation,
JSON parsing, compiler, Go hoặc SQLite. C không đổi live handle. NGINX graceful
reload/fork giữ old generation cho old workers qua process isolation/OS COW.
Không phải atomic pointer swap đồng thời toàn worker/fleet.

FFI v3 trả generation, rule ID, decision, score, log count bằng value struct.
Biến optional $aurora_waf_generation của C có allocation trong request pool.
Log action là best-effort summary ở info level, giới hạn 100/giây/worker; default
demo error_log warn không ghi info. Không có lossless event collector; quá budget
bỏ summary, không bỏ enforcement. File logging vẫn có thể chịu disk latency.

## Go API trực tiếp :8080

Mọi Rules route yêu cầu Authorization: Bearer TOKEN. Token private file cấu hình
bằng AURORA_ADMIN_TOKEN_FILE. Thiếu token config trả 503, không mở anonymous.
AURORA_COMPILER_PATH là binary Rust tin cậy, không lấy path từ API.
Reject cross-origin/cross-site. Đây là single-operator credential; audit actor là
management-token, chưa có OIDC/RBAC hoặc danh tính từng người.

| Method / route | Workflow |
| --- | --- |
| GET /api/v1/rules | search/group/action/severity/enabled; limit 1..100, after cursor, ID ascending |
| GET /api/v1/rules/stats | Tổng/enabled/log/block; không giả là applied |
| GET /api/v1/rules/:id | Flat current definition + version |
| GET /api/v1/rules/:id/history | Audit summaries, limit/before cursor |
| POST /api/v1/rules | Create, Idempotency-Key 16..128 chars |
| POST /api/v2/rules | Create full definition + immutable revision; không deploy |
| PUT /api/v1/rules/:id | Full replacement, enabled + expected_version |
| POST /api/v1/rule-releases | Empty body, Idempotency-Key, freeze + validate |
| GET /api/v1/rule-releases/:id | Publication state/digest và activation_phase |

Create JSON:

```json
{"name":"Protect admin","description":"Local exact-path rule","group":"endpoint",
 "action":"block","severity":"high","score":5,"priority":100,
 "path":"/admin","enabled":true}
```

PUT thêm expected_version. ID encode thành JSON string. Enum dùng lowercase machine
values, không dùng label UI. HTTP errors: 400 JSON/cursor, 401 token, 403 origin,
409 conflict, 415 content type, 422 invalid/unsupported, 503 compiler unavailable.
Không có HTTP activation endpoint; API mutation không gọi shell/reload.

## Build/run

```bash
make rules-init
make build
make run
make rules-test
```

rules-init chỉ tạo token/snapshot nếu chưa tồn tại, không overwrite. Token ở
control-plane/data/admin.token (0600, gitignored), không in ra terminal. Không đưa
token vào React bundle, git hay URL. Go vẫn chạy systemd user và phục vụ UI trực tiếp.

Sau khi gọi publish thành công, dùng ID release từ response:

```bash
build/aurora-activate --release 1
curl -i http://127.0.0.1:8090/__aurora_blocked
```

Bootstrap dùng schema v1 từ examples/runtime-policy.json. Publish thay thế toàn bộ
ruleset; để giữ block demo cần tạo rule /__aurora_blocked trước publish. Không auto
import mock UI hoặc seed SQLi/XSS rồi tuyên bố đã bảo vệ.

Default DB control-plane/data/aurora.db, active build/runtime/active-policy.json.
NGINX config phải tham chiếu đúng active file. Các paths/NGINX binary/prefix/config
do operator tin cậy cấu hình; fixed reload unit aurora-waf-nginx.service.
Chỉ dùng private local filesystem trong cùng trust domain với user service.

## Atomic activation / recovery

1. Flock theo policy path, không block request hoặc rule mutation.
2. Đọc ready release bằng authority projection riêng của activation.
3. Commit journal pending + previous bytes trước khi đổi file.
4. Temp cùng directory, fsync file, atomic rename, fsync directory.
5. nginx -t lỗi: atomic restore previous bytes, ghi rejected.
6. CLI kiểm tra worker draining qua /proc; nếu thấy thì giữ pending, retry cùng ID.
7. Gửi HUP cho fixed unit rồi ghi reload_requested — không ghi applied.

SQLite và filesystem không atomic chung. Crash ở commit/rename/signal/journal
boundary reconcile bằng retry cùng ID. Signal có thể đã tới master: retry là
at-least-once, không exactly-once. Pending chặn activation release khác; generation
cũ bị reject. Rollback nội dung cần publish generation mới; chưa có rollback API.

X-Aurora-Generation chỉ chứng minh worker trả response, không là all-worker ACK.
Old/new workers có thể cùng tồn tại khi drain. CLI draining guard không kiểm soát
HUP ngoài workflow và không thay thế bounded-backlog/long-lived-request hardening.
Không ép kill request dài để đạt latency giả. Không truncate active snapshot;
module code update cần full stop/start, không HUP để đổi shared object.

## Verification và giới hạn

- Rust/FFI lifecycle, null/bounds/layout, order/log/allow/block, snapshot isolation.
- HTTP auth/origin/strict payload, idempotency/conflict và revision immutability.
- 20 concurrent updates: một winner; publish retry giữ frozen revision.
- Activation invalid config restore, signal uncertainty/retry, disk drift, stale ID.
- NGINX thật: 20 clients, 2 workers, 6 generations dưới traffic; kiểm tra response
  decision theo generation, Go race detector; legacy module lifecycle vẫn pass.
- Vòng cuối 2026-09-05: 67.557 requests trong test khoảng 4 giây; một response 64 KiB
  rate-limited giữ generation 0 xuyên sáu reload và hoàn tất nguyên vẹn. Đây là
  kiểm tra correctness ngắn, không suy diễn thành benchmark throughput production.

Stress test ngắn, chưa phải sustained soak/RSS/latency certification.
Chưa có body/regex/detectors/rate-limit, node-wide applied ACK, signed fleet artifacts,
dedicated rollback, extended edit UI, sessions/RBAC hoặc production certification.

## Instance local sau verification

Go :8080 và NGINX :8090 đang chạy bằng systemd user services. Đã tạo đúng một
rule demo /__aurora_blocked để giữ hành vi cũ, publish release 1 và quan sát header
generation 1 với 403. Dừng Go thật vẫn giữ allow/block; restart giữ rule/release/audit.
Bản sao DB trước nâng journal nằm ở control-plane/data/aurora.before-rules-20260905.db.
Không xóa/ghi đè DB cũ hoặc tự nhập mock rules UI.
