# C ABI v3 — implemented

Header: `adapters/nginx/include/aurora_waf.h`. Rust library và C module phải dùng cùng
ABI version; bootstrap v1 probes đã được thay thế. Module verify ABI == 3 lúc init.

| Hàm | Contract |
| --- | --- |
| `aurora_waf_abi_version()` | Trả 3 |
| `aurora_waf_create(data,len,out)` | Parse/copy policy, trả owned opaque handle |
| `aurora_waf_evaluate(handle,path,len,action)` | Borrow normalized path trong call; không giữ pointer |
| `aurora_waf_evaluate_v3(handle,path,len,out)` | Trả AuroraDecision bằng value, path chỉ borrow trong call |
| `aurora_waf_generation(handle)` | Generation của immutable handle, null/v1 trả 0 |
| `aurora_waf_destroy(handle)` | Giải phóng đúng một lần; null là no-op |

Status 0 = success, 1 = invalid policy/input, 2 = caught panic. Action 0 = allow,
1 = block. Evaluate đặt action block trước validation; caller vẫn bắt buộc kiểm
tra status. Create đặt out=null trước validation. C adapter map lỗi evaluate → 503.

AuroraDecision có layout C 32 bytes: uint64 generation/rule_id, uint32 action/score/
log_matches/reserved. Reserved luôn 0. Rule ID là match cuối được evaluate, không
phải danh sách mọi log rule. Log không terminal; action là quyết định hiệu lực.
Hàm evaluate cũ giữ để compatibility harness; module dùng evaluate_v3.
Snapshot schema v2 và activation contract: [RULES_BACKEND.md](RULES_BACKEND.md).

Input data phải trỏ tới vùng memory đọc được đúng len; out/action phải writable,
aligned. Null/size được kiểm tra nhưng dangling pointer không thể được xác minh
an toàn. Handle phải live, không concurrent destroy; double-free hoặc use-after-free
là vi phạm caller contract. Rust không free NGINX buffer hoặc giữ request pointer.

Limits: policy 1..65536 bytes, URI 1..8192 bytes. JSON chỉ parse trong create,
lookup immutable không IO hoặc allocation. NGINX config pool sở hữu cleanup;
các location kế thừa có thể dùng chung engine cùng config cycle.

Panic unwind được catch trong ABI wrappers; không recover UB, OOM abort hoặc
process crash. Engine hiện dùng collections có destructor không panic. Static
link Rust vào module; không cần deploy libaurora_ffi.so bên cạnh module.

`make ffi-smoke` chạy C harness: 1000 lifecycle iterations, allow/block, null/size
errors. C harness ASan/UBSan/LeakSanitizer cũng đã chạy pass; Rust library không
được compiler-instrument toàn bộ bằng sanitizer trong phép kiểm tra này.
`make module-test` kiểm tra lifetime qua NGINX reload/quit thực.

Xem [runtime](RUNTIME.md) cho policy format, inheritance và scope bảo vệ.
