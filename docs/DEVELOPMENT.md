# Development

## Prerequisites

Linux, Make, C compiler, Rust 1.98.1 + rustfmt/clippy, Go 1.27.1,
Node 26.8.1 và npm 12.0.2. Xem [TOOLCHAIN.md](TOOLCHAIN.md) cho version pins,
nguồn stable và cách chuẩn bị môi trường. CI đọc các manifest cùng với local.

```bash
make ui-install
make check
make controller
# Một terminal khác
make ui
```

Controller `127.0.0.1:8080`; UI dev URL được Vite in ra (mặc định port 5173).
SQLite tự tạo ở `control-plane/data/aurora.db` qua `make controller`; không cần database
server hoặc NGINX cho foundation. `npm ci` dùng lockfile đã commit;
khi chủ động đổi dependencies dùng `npm install` và review lockfile.

## Kiểm tra riêng

```bash
make rust-check
make go-check
make ffi-smoke
make ui-build
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
curl http://127.0.0.1:8080/api/v1/status
```

Rust có policy/evaluation tests. Go có embedded console và SQLite/HTTP integration
tests. C smoke kiểm tra ABI v2. `make module-test` kiểm tra module/lifecycle thực.
Go build cần UI build trước; dùng Make targets để đáp ứng dependency go:embed.
Không diễn giải `cargo test` pass thành detection đã được kiểm chứng.

## Quy ước

- Engine không import NGINX/HTTP server types; adapter chuyển dữ liệu sang core contract.
- Semantics thay đổi phải cập nhật docs, fixtures và ADR khi có tradeoff lớn.
- Go sở hữu orchestration, Rust sở hữu compilation/matching; tránh hai validator lệch nhau.
- Không đưa secret, packet captures thật hay build artifacts vào repository.
- `cargo fmt`, `cargo clippy`, `gofmt`, `go vet`, TypeScript check là gate cơ bản.

## Ghi chú workspace hiện tại

Môi trường cung cấp `.git` placeholder không đọc được như repository hợp lệ.
Setup không khởi tạo lại hoặc sửa `.git`. Go development build dùng
`-buildvcs=false` để chạy được trong source snapshot; release cần inject version,
commit và artifact provenance qua pipeline được kiểm tra.
Nếu dùng Codex tại workspace này, tuân thủ `/home/phucle/.codex/RTK.md`:
shell commands đi qua `rtk` hoặc `rtk proxy`.

Nếu sandbox không cho ghi Go cache mặc định, dùng cache trong vùng writable:

```bash
GOCACHE=/tmp/aurora-waf-go-cache make check
```

## Kết quả setup ban đầu 2026-09-05 (trước nâng toolchain)

- Rust fmt/clippy và test harness: pass; chưa có unit test cases.
- Go test harness/vet/build: pass; chưa có unit test cases.
- C → Rust shared-library runtime smoke: pass, ABI 1 và readiness 0.
- TypeScript check + Vite production build: pass; npm dependency lockfile đã tạo.
- HTTP smoke: `/healthz`, `/api/v1/status`, Vite HTML và Vite `/api` proxy: pass.
- Kiểm tra 24 Markdown files: không có local link bị thiếu target.

Sandbox cần cho phép network để tải npm dependencies và mở localhost để chạy HTTP
smoke. Hai server thử nghiệm đã được dừng sau smoke. Chưa chạy browser interaction,
NGINX integration, hosted CI, detection benchmark hoặc security tests; các phần này
có task riêng trong roadmap.

## Cập nhật Go structure + SQLite

`make go-check` pass với 3 integration tests về storage/restart/readiness, `go vet`
và build. HTTP smoke trên cổng localhost tạm đã kiểm tra `/readyz`, status contract,
restart cùng database và shutdown SIGTERM sạch. Baseline Go hiện theo `go.mod` và
[TOOLCHAIN.md](TOOLCHAIN.md). Chi tiết folder structure và env config ở `control-plane/README.md`.
