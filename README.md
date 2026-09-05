# Aurora WAF

WAF cho NGINX với **Rust engine**, **C adapter**, **Go control plane** và
**React console tùy chọn**. Policy được chuẩn bị ngoài request path; worker xử lý
request bằng policy đã nạp cục bộ.

Trạng thái: **runtime bootstrap chạy được**. React nhúng trong Go controller; NGINX
dynamic module gọi Rust runtime để allow/block theo exact-path policy. Đã kiểm tra
reload và controller outage. Đã có [Rules backend](docs/RULES_BACKEND.md): SQLite revisions,
exact-path compiler, ABI v3 và journaled activation CLI. [Create Rule](docs/CREATE_RULE.md)
đã nối React → Go → SQLite, kèm list/detail/history thật; lưu không đồng nghĩa deploy.
Chưa có SQLi/XSS, body inspection, full compiler hoặc fleet
management. Xem [runtime contract](docs/RUNTIME.md); chưa dùng cho production.

## Chạy development

Foundation dùng systemd user services. Sau build, `make run` phục vụ UI/API trực tiếp từ Go tại
**http://127.0.0.1:8080** (không qua NGINX). Chỉ chạy management: `make run-controller`.
Xem [LOCAL_RUN.md](docs/LOCAL_RUN.md) để start/stop và xem
chi tiết bản cài NGINX. Demo WAF data plane ở **http://127.0.0.1:8090/ok**;
`/__aurora_blocked` trên cổng 8090 trả 403.

Baseline: Rust 1.98.1 (edition 2024), Go 1.27.1, Node 26.8.1, npm 12.0.2,
Make và C compiler; môi trường mục tiêu ban đầu Linux. Xem [toolchain](docs/TOOLCHAIN.md)
để cài đúng version đã pin. Controller dùng SQLite
local; xem [Go structure/config](control-plane/README.md).
Toolchain đã kiểm tra tại thời điểm setup nằm trong [DEVELOPMENT.md](docs/DEVELOPMENT.md).

```bash
make ui-install
make rules-init
make check
make build
make module-test
make run
```

Development HMR: `make controller` và `make ui` ở terminal khác.
API local: `http://127.0.0.1:8080/api/v1/status`.
`make ffi-smoke` kiểm tra thư viện Rust từ C, không cần NGINX.

## Cấu trúc

```text
crates/engine/            Rust core độc lập adapter
crates/ffi/               C ABI boundary
adapters/nginx/          C HTTP module + ABI header/harness
control-plane/           Go management service
ui/                      React console tùy chọn
docs/                    Thiết kế, contracts, vận hành, quyết định
examples/                Policy minh họa, chưa được engine thực thi
```

## Tài liệu

- [Validation ý tưởng](docs/VALIDATION.md): khả thi, giới hạn, lựa chọn.
- [Phạm vi sản phẩm](docs/PRODUCT.md) và [kiến trúc](docs/ARCHITECTURE.md).
- [Roadmap stage → phase → task](ROADMAP.md): dependency và tiêu chí hoàn thành.
- [Rule language](docs/RULES.md), [snapshot](docs/SNAPSHOTS.md), [FFI](docs/FFI.md).
- [Management API](docs/API.md) và [threat model](docs/THREAT_MODEL.md).
- [Development](docs/DEVELOPMENT.md), [testing](docs/TESTING.md), [deployment](docs/DEPLOYMENT.md).
- [Observability](docs/OBSERVABILITY.md), [ADRs](docs/adr/README.md).
- [Đóng góp](CONTRIBUTING.md), [bảo mật](SECURITY.md), [changelog](CHANGELOG.md).

Chưa chọn license phân phối; không mặc định dự án đã được cấp phép open source.
