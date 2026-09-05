# Go control plane

Rules backend và activation: [contract/runbook](../docs/RULES_BACKEND.md).
Chạy systemd: `make rules-init`, `make build`, `make run-controller` từ repo root.
Token file và compiler path được runner cấu hình; UI/API trực tiếp Go, không qua NGINX.

Chạy `make controller` từ repo root. Server development bind `127.0.0.1:8080`.
SQLite tự tạo ở `control-plane/data/aurora.db` khi chạy bằng Make target.
Go 1.27.1 theo `go.mod`; driver `modernc.org/sqlite` qua `database/sql`, không cần CGO.

## Cấu trúc

Tham khảo cách chia layer của `aurora/cost-manager/api/internal`:

```text
cmd/main.go                  Entry point, signals
infra/sqlite.go              SQLite connection và connection settings
migrations/                 Embedded SQL
internal/
  app/                      Lifecycle, module wiring, routes, migrations
  config/                   Environment configuration
  domain/
    entity/                 Domain data
    repo/                   Repository interfaces
    service/                Service interfaces
  repository/               SQL implementations
  service/                  Use cases
  transport/http/handler/   HTTP decoding/status/JSON
  test/integration/         SQLite và HTTP integration checks
```

Dependency: handler → domain service interface → service → domain repo interface →
repository. `app/module.go` inject implementations. `domain` không import HTTP/SQL.
Thêm middleware, taxonomy, genproto hoặc provisioner khi có nhu cầu triển khai thật.

## Configuration và storage

| Environment | Default | Ý nghĩa |
| --- | --- | --- |
| `AURORA_HTTP_ADDR` | `127.0.0.1:8080` | HTTP bind address |
| `AURORA_SQLITE_PATH` | `data/aurora.db` | Filesystem path tương đối working directory |

Không tự load `.env`; export biến môi trường hoặc truyền qua service manager.
SQLite dùng WAL, foreign keys, busy timeout 5 giây, synchronous FULL và một connection
trong pool. PRAGMAs theo connection được áp dụng cả khi pool mở connection thay thế.
MVP một controller với disk local. Không chia sẻ DB qua NFS hoặc nhiều máy.

Startup chạy bootstrap migration trong transaction, giữ ledger `schema_migrations`,
reject schema version mới hơn binary. Hiện chỉ có migration ledger, chưa có bảng
policy/rule/event. Xem [ADR SQLite](../docs/adr/0004-go-layout-sqlite.md).

`GET /healthz`: process health. `GET /readyz`: đọc được schema ledger (503 khi lỗi),
không chứng minh write capacity hoặc WAF enforcement. `GET /api/v1/status`: giữ nguyên
response foundation với `enforcement_ready: null` vì controller không quan sát NGINX
node. Shutdown drain HTTP trước đóng DB. React build được nhúng vào binary qua
`internal/console`; `make go-check` và `make controller` build frontend trước.

Chưa có authentication, rule CRUD hay agent. Không expose server development ra mạng
công cộng. Thiết kế API đích: [API.md](../docs/API.md).
