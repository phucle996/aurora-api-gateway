# Chiến lược kiểm thử

## Foundation hiện tại

`make check`: Rust fmt/clippy/build-test harness, Go build/vet/SQLite integration tests, C→Rust
link/runtime smoke và TypeScript/Vite production build. Engine có exact-path behavior
tests; `make module-test` kiểm tra module trên NGINX thật, invalid/valid reload và tải
500 requests/concurrency 20. HTTP/UI standalone và controller outage đã được smoke.

Go storage tests dùng database file tạm để kiểm tra dữ liệu qua restart, migration
idempotency, PRAGMAs trên connection thay thế, schema version tương lai/corrupt DB,
và readiness failure khi DB đóng. Chạy riêng bằng `make go-check`.

## Gates theo tầng

| Tầng | Bài kiểm tra bắt buộc khi implementation xuất hiện |
| --- | --- |
| Compiler | Schema invalid, duplicate ID, deterministic artifact, incompatible version |
| Engine | Match + non-match, score/action precedence, encoding, exclusions, input limits |
| Parser | Invalid bytes, percent encoding, duplicate params/headers, JSON/multipart bounds |
| FFI | Null/empty handling, allocation ownership, ABI/layout, panic conversion, sanitizers |
| NGINX | H1/H2 body callbacks, chunked input, temp files, disconnect, redirects, subrequests |
| Lifecycle | Invalid reload, retained generation, config failure, rollback, worker drain |
| Controller | RBAC, concurrent revision edits, idempotency, persistence/restart |
| Agent | Tamper/replay, interrupted download, disk full, TLS rotation, controller outage |
| UI | Validation workflow, publish status, unavailable API, stored XSS in events, accessibility |

Fuzz compiler/snapshot loader và normalization, không chỉ matcher. C boundary kiểm
tra bằng C harness; Rust-only tests không chứng minh ABI đúng. Chỉ fuzz valid memory
contracts; truyền pointer ngẫu nhiên vào FFI không phải cách kiểm thử an toàn.

## Benchmark protocol

Baseline NGINX không WAF → module disabled → enabled empty policy → policy đại diện.
Cùng host, build flags, worker count, keepalive, TLS, body sizes và load generator.
Ghi throughput, p50/p95/p99 latency, CPU, RSS per worker, error rate và event drops.
Tách benign, malicious, worst-case regex/normalization và reload trong lúc tải.

Stage 0 chốt workload và budget; không tự đặt con số marketing. Báo cáo phải chứa
hardware, kernel, NGINX/compiler versions, warmup, duration, concurrency, rule count
và raw results. Gate production yêu cầu budget đã duyệt ở Stage 0 đạt trên ma trận
đích; false-positive rate được đo trên corpus benign có nguồn và kích thước rõ.
