# Management API

## Implemented: local development

| Method | Path | Hành vi |
| --- | --- | --- |
| GET | `/healthz` | 200 JSON `{"status":"ok"}`; process liveness |
| GET | `/readyz` | 200 khi đọc được SQLite schema ledger; 503 khi lỗi storage |
| GET | `/api/v1/status` | 200 JSON; foundation, `enforcement_ready: null` (chưa có node observer) |

Có SQLite rules/revisions và token-auth Rules API: [RULES_BACKEND.md](RULES_BACKEND.md).
Policy assignment/session/RBAC vẫn chưa có. Server mặc định bind loopback.
Readiness không chứng minh write capacity hoặc WAF enforcement. UI dev proxy gọi `/api/v1/status`.
Không có endpoint nào dùng để xin allow/deny cho từng request.

## Planned: Stage 3–4

| Method | Path | Mục đích |
| --- | --- | --- |
| GET/POST | `/api/v1/policies` | List/create draft |
| GET/PATCH | `/api/v1/policies/{id}` | Đọc/sửa với expected revision |
| POST | `/api/v1/policies/{id}/validate` | Diagnostics, không activate |
| POST | `/api/v1/policies/{id}/publish` | Tạo deployment, trả 202 + ID |
| POST | `/api/v1/deployments/{id}/rollback` | Rollback có audit |
| GET | `/api/v1/deployments/{id}` | Desired/applied per node |
| GET | `/api/v1/nodes` | Health, last_seen, active revision |
| GET | `/api/v1/events` | Filter, cursor pagination, redacted events |
| GET | `/api/v1/metrics` | Console aggregates; khác exporter `/metrics` |

Rule CRUD thuộc policy revision; tránh endpoint edit rule làm đổi active policy ngay.
Stage 3 tạo OpenAPI executable trước khi triển khai workflows.

Auth đích: OIDC cho operator, RBAC viewer/editor/publisher/admin; agent dùng identity
riêng qua mTLS hoặc scoped token có rotation. Session cookie cần CSRF defense;
CORS chỉ origin cụ thể. Audit write/publish/rollback không lưu secrets.
Lỗi theo envelope `{code, message, request_id, details}` với diagnostics có giới hạn.
409 cho revision conflict, 422 cho validation failure, 401/403 cho auth.
Publish retry cần idempotency key; list/event queries phải bounded và paginated.
