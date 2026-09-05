# Deployment và vận hành — thiết kế đích

Hiện chỉ có local development. Chưa có Docker images, compose production,
Aurora `.deb`/`.rpm` hoặc lệnh `apt install aurora-waf` hoạt động.

Đã có [systemd user runner](LOCAL_RUN.md): Go phục vụ trực tiếp embedded UI + API
trên :8080; NGINX chỉ phục vụ exact-path WAF data plane :8090 qua `make build/run/stop`.
NGINX host là package stable chính thức 1.30.4 cài user-local; không phải package Aurora.

## Các topology dự kiến

| Mode | Thành phần cần chạy | Policy |
| --- | --- | --- |
| Offline core | NGINX + C/Rust artifact | Compiler CLI + local snapshot |
| Managed node | Core + Go agent | Controller phân phối, local last-known-good |
| Management | Go API + SQLite trên local disk | Quản lý revisions và audit; artifacts là files riêng |
| Console | React static assets | Gọi Management API; hoàn toàn optional |

Một máy hoặc nhiều máy đều giữ cùng ranh giới control/data plane. Agent không bắt
buộc cho offline mode; UI không phải dependency startup của node.

## Packaging target

Mỗi artifact khai báo NGINX version/build compatibility, OS, architecture, engine
ABI và snapshot version. Lựa chọn link Rust static/dynamic được quyết định sau
prototype; foundation dùng shared library để kiểm chứng ABI, chưa chốt package layout.
Matrix Linux x86_64 đầu tiên; arm64 chỉ công bố sau tests riêng.

Core package dự kiến chứa module, engine nếu dynamic link, config example và CLI
hoặc hướng dẫn tạo snapshot. Agent, controller và UI tách package/service.
Release phải có checksums, SBOM, provenance, license inventory và upgrade notes.

## Runbook đích

1. Compile/validate policy ở detection-only; kiểm tra false positives.
2. Stage artifact, verify compatibility và chạy `nginx -t`.
3. Reload graceful, quan sát applied revision, worker errors và latency.
4. Bật enforce ở canary scope; mở rộng khi metrics ổn định.
5. Khi lỗi, rollback generation đã biết tốt; xác nhận revision thực tế trên node.

Controller outage: không reload mù quáng, dùng active snapshot và báo stale.
Cold start thiếu snapshot: startup thất bại khi WAF được enable. Emergency bypass
phải là thao tác operator có audit, không tự động âm thầm đổi sang off.
Backup policy sources, revisions, signing keys theo secret procedure và audit DB;
test restore trước production. Không backup raw secrets vào repository.
