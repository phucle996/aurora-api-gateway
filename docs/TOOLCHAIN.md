# Toolchain và dependency baseline

Baseline stable đối chiếu ngày **2026-09-05**. Pin version cụ thể để local và CI
cùng build một cấu hình; không dùng beta/RC/nightly hoặc tự trôi theo `latest`.

| Thành phần | Version | Source of truth trong repo |
| --- | --- | --- |
| Go | 1.27.1 | `control-plane/go.mod`; CI đọc file này |
| Rust | 1.98.1 | `rust-toolchain.toml`; workspace `rust-version` tương ứng |
| Rust edition / resolver | 2024 / 3 | `Cargo.toml` |
| Node.js | 26.8.1 Current | `.nvmrc`; CI đọc file này |
| npm | 12.0.2 | `ui/package.json` → `packageManager`; CI đọc field này |
| React / React DOM | 19.2.8 | `ui/package.json` + lockfile |
| TypeScript | 7.0.2 | `ui/package.json` + lockfile |
| Vite | 8.2.2 | `ui/package.json` + lockfile |
| React / React DOM types | 19.2.18 / 19.2.7 | `ui/package.json` + lockfile |
| Go SQLite driver | modernc.org/sqlite 1.58.0 | `control-plane/go.mod` + `go.sum` |
| NGINX local runner | 1.30.4 stable | [LOCAL_RUN.md](LOCAL_RUN.md) |
| GitHub checkout / setup-go / setup-node | 7.0.1 / 7.0.0 / 7.0.0 | `.github/workflows/ci.yml` |

Node 26.8.1 là release Current, không phải prerelease. Node 24.20.0 là LTS mới nhất
tại ngày đối chiếu; repo chọn Current theo yêu cầu dùng stable mới nhất.
[Node release index](https://nodejs.org/dist/index.json).

Go/Rust được đối chiếu từ [Go releases](https://go.dev/dl/?mode=json) và
[Rust stable manifest](https://static.rust-lang.org/dist/channel-rust-stable.toml).
Dependencies frontend theo dist-tag `latest` của package chính thức trên npm:
[React](https://www.npmjs.com/package/react), [TypeScript](https://www.npmjs.com/package/typescript),
[Vite](https://www.npmjs.com/package/vite), [npm](https://www.npmjs.com/package/npm).
SQLite dùng version được đóng gói trong [driver](https://pkg.go.dev/modernc.org/sqlite),
không thay system SQLite riêng rồi coi engine driver đã được nâng cấp.
Actions theo release chính thức của
[checkout](https://github.com/actions/checkout/releases),
[setup-go](https://github.com/actions/setup-go/releases),
[setup-node](https://github.com/actions/setup-node/releases).

## Phạm vi nâng cấp

Workflow owner là developer/CI build. Manifest và lockfiles là authority;
toolchain cache chỉ là dữ liệu tải lại được. Nâng cấp phải giữ nguyên status API,
SQLite migration/data và C ABI; lỗi compatibility phải được sửa trước khi công bố
baseline đã kiểm tra. Không thay schema nghiệp vụ trong workflow nâng version.

Rust edition 2024 yêu cầu `unsafe(no_mangle)` cho exported symbols; C ABI names và
types vẫn giữ nguyên. [Edition migration](https://doc.rust-lang.org/edition-guide/rust-2024/unsafe-attributes.html).
Vite 8 đổi bundler/transformer; kiểm tra production build và dev proxy sau nâng cấp.
[Vite migration](https://vite.dev/guide/migration).

C smoke vẫn dùng C11 làm compatibility floor cho FFI; đây là language standard,
không phải package version. NGINX 1.30.4 đã được cài cho local runner và module
bootstrap đã load/test trên host này; mở rộng build matrix vẫn thuộc roadmap.

## Local và update workflow

Nếu có nvm, chạy `nvm install` và `nvm use` ở repo root để đọc `.nvmrc`.
Cài npm version trong bảng bằng package manager của môi trường. Rustup đọc
`rust-toolchain.toml` tự động. Go hỗ trợ auto toolchain selection từ `go.mod`;
với `GOTOOLCHAIN=local`, phải cài Go đúng baseline trước khi build.

Sau khi đổi version: regenerate npm lockfile và `go mod tidy`, chạy `make ui-install`
rồi `make check`, kiểm tra HTTP status/readiness/dev proxy và cập nhật bảng này.
Chỉ nâng dependency đã có nhu cầu; không đổi kiến trúc hoặc thêm helper cùng đợt upgrade.

## Kết quả kiểm tra baseline

- Node 26.8.1/npm 12.0.2: `npm ci` từ lockfile pass; audit lúc install không báo vulnerability.
- Rust 1.98.1: fmt/clippy/test harness pass; C → Rust runtime ABI smoke pass.
- Go 1.27.1: SQLite integration tests, vet và controller build pass.
- TypeScript 7.0.2/Vite 8.2.2: production build pass sau khi thêm Vite client types
  cho side-effect CSS imports; không tắt type checking để bỏ qua lỗi.
- Runtime: controller readiness/status, Vite TSX transform và API proxy trả kết quả
  mong đợi; Vite CLI startup/SIGTERM smoke pass. Programmatic Vite smoke cần dừng
  process thử nghiệm thủ công khi cleanup chờ; CLI shutdown riêng đã kiểm tra thành công.
- Local links của 28 Markdown files hợp lệ. Hosted GitHub Actions chưa được chạy.

Node/npm dùng toolchain tạm qua `npm exec` khi verify; không đổi global Node/npm
của người dùng. Local development cần chọn version từ `.nvmrc` và `packageManager`.
