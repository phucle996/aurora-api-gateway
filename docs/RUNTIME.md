# Runtime bootstrap — implemented

Update: [Rules backend](RULES_BACKEND.md) bổ sung schema v2, exact-path allow/log/block,
generation, ABI v3, SQLite publish và activation CLI. Baseline schema v1 dưới đây
vẫn được hỗ trợ; full rule language chưa implement.

Mốc này có React embed trong Go controller, Rust exact-path policy runtime, C ABI v3
và dynamic module đã nạp/chạy trên NGINX stable 1.30.4, Ubuntu 26.04 amd64.
Đây là lát cắt hoạt động xuyên suốt; không phải full WAF hoặc production certification.

## Luồng và authority

Management: browser → Go :8080 (systemd user service) → embedded React/API/SQLite.
NGINX không proxy hoặc phục vụ management console/API.
Data plane thử nghiệm: client → NGINX :8090 → C access hook → Rust evaluate → static demo backend.
Go không sở hữu hoặc khởi chạy engine handle trong worker; dừng Go chỉ làm mất console/API.

Policy file cục bộ là authority. Khi parse config, C đọc regular file tối đa 64 KiB,
Rust validate và copy vào engine bất biến; pool cleanup của NGINX destroy handle.
Worker thừa kế snapshot trong config cycle; không giữ request buffers sau evaluate.
Không có IO, JSON parsing, network call hoặc allocation cho lookup trên request path.

## Policy hiện có

```json
{"schema_version":1,"block_paths":["/__aurora_blocked"]}
```

Parser reject unknown fields/version, duplicate paths, encoded/noncanonical policy
paths, >1024 entries, >64 KiB input. Mỗi path <=8192 bytes; policy chỉ ASCII và path
bắt đầu `/`. Engine so sánh byte-exact với `r->uri` đã chuẩn hóa bởi NGINX; không
match query, headers, method, body hay prefix. `/blocked/child` không match `/blocked`.
`%62locked` trên HTTP request được NGINX normalize trước khi evaluate.

Giới hạn request invalid/oversized qua ABI trả lỗi, adapter trả 503. Policy block →
403; allow → tiếp tục pipeline NGINX. Mode audit chỉ log would-block và tiếp tục;
engine error vẫn trả 503. Log riêng Aurora không append raw request/query.

## Directives và lifecycle

```nginx
load_module build/modules/ngx_http_aurora_waf_module.so;
http {
    server {
        listen 127.0.0.1:8090;
        aurora_waf on;
        aurora_waf_policy examples/runtime-policy.json;
        aurora_waf_mode enforce; # enforce | audit
        # proxy_pass/static content tại location; tránh return trước access phase.
    }
}
```

Directives kế thừa ở http/server/location. Default off; enabled bắt buộc policy hợp
lệ. `satisfy any` bị reject ở protected location để không bypass WAF bằng access rule khác.
Internal redirect chạy lại inspection theo URI/location mới. Subrequest không chạy
access phase như main request: chưa hỗ trợ protection subrequest độc lập. Rewrite-phase
`return` hoàn tất trước access hook; không dùng nó để kiểm thử enforcement.

Thay policy bằng atomic rename rồi validate và HUP. Invalid update giữ old workers/
old policy; request mới vào workers mới khi reload thành công. Không cam kết toàn worker
đổi generation đồng thời. NGINX đóng idle keepalive khi graceful reload; client phải
xử lý reconnect theo semantics HTTP. Thay binary module cần full stop/start, không
coi HUP là hot reload code. Build cài module bằng rename, không truncate inode đang mmap.

## Build

`make build` build UI → Go embed và Rust staticlib → NGINX module. `make module` chỉ
build module, không build controller. Static linking Rust vào module loại bỏ dependency
runtime vào `libaurora_ffi.so`. Không dùng thư viện FFI riêng với `load_module`.

Source NGINX pin 1.30.4 và SHA-256, đã xác minh PGP từ upstream. Script ở
`scripts/build-nginx-module.sh` dùng `--with-compat` và PCRE-enabled signature.
Ubuntu thiếu PCRE headers dùng package dev được apt xác minh, giải nén vào build/
không cài root. Fallback package chỉ cho Ubuntu 26.04 amd64; môi trường khác cần
system libpcre2-dev thích hợp. `nginx -t` là gate compatibility thực tế cho host.
Chưa chứng nhận ma trận OS/NGINX khác.

## Bằng chứng

- Go console tests: GET/HEAD, SPA fallback, missing assets/API, method restriction.
- Copy Go binary sang thư mục tạm không có UI files: HTML/JS/CSS vẫn phục vụ được.
- Rust policy/decision tests và C harness 1000 create/evaluate/destroy, null/limits.
- C harness ASan/UBSan/LeakSanitizer pass; không thay thế sanitizer/fuzz đầy đủ cho Rust và NGINX.
- NGINX: load, inheritance, off/audit, policy override, URI normalization, internal
  redirect, reject missing policy/satisfy-any, audit query redaction.
- Invalid direct HUP giữ policy; valid HUP hoạt động cùng 500 requests, concurrency
  20, Connection: close, không retry lỗi quyết định; không có worker crash trong log.
- Dừng controller thật: data plane `/ok` vẫn 200, blocked path vẫn 403.
  Với topology trực tiếp, khi Go dừng thì cổng management không còn phục vụ.
- Integration cũng pass trên NGINX 1.30.4 build từ source theo CI recipe; hosted CI chưa chạy.

Chưa có full compiled rule language, SQLi/XSS, body inspection, rate limit, fleet agent,
policy assignment/RBAC, long soak/fuzz/sanitizer suite hoặc HTTP/2 coverage. Các stage rộng
hơn trong roadmap vẫn mở. Không tuyên bố protection ngoài exact-path contract này.
