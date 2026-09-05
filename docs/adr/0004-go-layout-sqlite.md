# ADR 0004: Go layered structure và SQLite

Status: Accepted; storage bootstrap implemented. Date: 2026-09-05.

## Context

Theo yêu cầu người dùng, Go tham khảo folder structure
`/home/phucle/Desktop/aurora/cost-manager/api/internal` và sử dụng SQLite.
Controller MVP chạy một instance, cần local persistence không có database service riêng.

## Decision

Dùng `internal/app`, `config`, `domain/{entity,repo,service}`, `repository`, `service`,
`transport/http/handler`, `test/integration`. Giữ `infra` và embedded SQL `migrations`
bên cạnh `internal`, tương tự reference. Wiring bằng constructor trong `app/module.go`.
Giữ HTTP standard library hiện có; folder structure không yêu cầu copy framework,
Redis/PostgreSQL, billing domains hoặc generated protocols từ dự án tham khảo.

SQLite qua `database/sql` + `modernc.org/sqlite` v1.58.0, driver không cần CGO, yêu cầu
Go >= 1.25 từ phía driver; project pin Go 1.27.1 theo baseline
[toolchain](../TOOLCHAIN.md). [Driver documentation](https://pkg.go.dev/modernc.org/sqlite).
Database path local configurable; WAL, foreign_keys ON, busy_timeout 5000 ms,
synchronous FULL. Một connection ở foundation; mọi connection thay thế có cùng PRAGMAs.

SQLite WAL vẫn chỉ có một writer tại một thời điểm và cần cùng host; không dùng
network filesystem. Chọn local storage cho single-controller MVP, xem lại thiết kế
khi làm HA. [SQLite WAL documentation](https://www.sqlite.org/wal.html).

## Consequences

Startup phải mở DB và bootstrap thành công trước HTTP listen. `/readyz` kiểm tra đọc
ledger, `/healthz` độc lập DB. Schema version không hỗ trợ bị reject. Hiện chưa có
policy persistence; general migration runner/checksums và backup/restore tests ở Stage 3.

Snapshot artifacts vẫn là files riêng, Rust/NGINX không đọc SQLite trên request path.
Event volume lớn cần storage/retention decision riêng, không mặc định ghi mọi request
vào DB quản trị. Không hứa thay database chỉ bằng đổi driver khi mở rộng HA.

Không copy riêng file `.db` khi đang có live WAL: backup online cần SQLite backup
API hoặc phương pháp snapshot nhất quán. Cold backup cần dừng controller và đóng các
connection trước khi copy. Runbook/restore drills hoàn chỉnh vẫn thuộc roadmap.

## Verification

Integration tests dùng file DB tạm: restart giữ dữ liệu, bootstrap idempotent,
PRAGMAs trên connection mới, reject schema tương lai/corrupt DB, readiness 503 khi
storage đóng trong khi liveness vẫn 200.
