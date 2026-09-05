# Changelog

## Unreleased

- Security Rules: real filtered totals/cursor pages, validated filters, historical
  revision-based monthly deltas (null without coverage), browser failure/recovery
  checks; removed inert list controls and fake cluster indicators on the list page.

- Rules backend: SQLite immutable revisions/audit, authenticated list/detail/history/stats,
  create idempotency và optimistic update/enable/disable. Freeze publication, Rust exact-path
  compiler/allow-log-block, ABI v3 generation và journaled atomic activation CLI.
  Kiểm tra 2 workers/20 clients/6 publications dưới traffic.
- Create Rule v2: full form validation, immutable SQLite definitions/revision, atomic
  idempotency/retry, authenticated React create/list/detail/history và browser recovery tests.
  Không Blueprint; unsupported definitions bị chặn publish, không thay đổi NGINX khi lưu.

- Nhúng React vào Go binary; thêm immutable Rust exact-path runtime, C ABI v2 và
  NGINX dynamic module load được trên 1.30.4. Thêm reload/load tests và demo data plane
  :8090 độc lập controller. `enforcement_ready` đổi sang null khi chưa có node observer.
- Thêm NGINX local runner cho UI/API với systemd user services, config validation,
  smoke checks và hướng dẫn run/stop; chưa có WAF HTTP module.
- Nâng baseline stable: Go 1.27.1, Rust 1.98.1/edition 2024, Node 26.8.1,
  npm 12.0.2, React 19.2.8, TypeScript 7.0.2, Vite 8.2.2; đồng bộ local/CI pins.
- Tổ chức Go theo internal layers tham khảo cost-manager; SQLite bootstrap, readiness,
  graceful shutdown và storage integration tests; Go baseline theo `control-plane/go.mod`.
- Khởi tạo Rust workspace và C ABI capability smoke test.
- Thêm Go development controller với health/status API.
- Thêm React/TypeScript console kết nối status API.
- Thêm architecture validation, contracts, runbooks và roadmap stage/phase/task.
- Chưa có WAF enforcement hoặc NGINX HTTP module.
