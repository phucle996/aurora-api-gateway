# Chạy foundation bằng systemd user services

Trạng thái: **embedded console + NGINX WAF runtime bootstrap chạy được**.
Go :8080 phục vụ trực tiếp React nhúng/API, không qua NGINX; NGINX :8090 dùng C/Rust module
enforce exact-path policy trên demo backend. Xem [RUNTIME.md](RUNTIME.md) cho scope.

## Bản cài trên máy này

- Ubuntu 26.04 amd64, NGINX stable **1.30.4**, package `1.30.4-1~resolute` từ
  [repository chính thức](https://nginx.org/en/linux_packages.html).
- Binary: `/home/phucle/.local/opt/nginx/1.30.4/usr/sbin/nginx`.
- Symlink trên PATH: `/home/phucle/.local/bin/nginx`.
- Cài user-local bằng cách giải nén package đã xác minh. Không đăng ký package với
  dpkg/apt, không tạo system-wide service và không có automatic apt upgrade cho bản này.
- Repository signature và SHA-256 package đã được kiểm tra. Các shared libraries
  cần thiết đã có trên host; không cần cài development headers để dùng binary.
- Vì sudo cần xác thực tương tác và 80/443 đang được dùng, stack bind loopback ở
  cổng 8080/8090. Không đổi dịch vụ đang chạy trên các cổng khác.

Nguồn xác định stable: [NGINX downloads](https://nginx.org/en/download.html),
đối chiếu 2026-09-05. Package SHA-256:
`dddea2a33ec2d1530d036fdcd43b6c90466e89240c2eb423761ca8d79a7897b8`.

## Build và run

Từ repo root, dùng Node/npm theo [toolchain](TOOLCHAIN.md):

```bash
make ui-install
make rules-init
make check
make build
make module-test
make run
```

Trên máy này có thể dùng toolchain npm tạm, không thay global Node/npm:

```bash
npm exec --yes --package=node@26.8.1 --package=npm@12.0.2 -- make build
make run
```

`make run` dùng systemd user services, yêu cầu user session có systemd hoạt động.
Services tiếp tục chạy khi đóng terminal; không enable autostart sau reboot/logout.
Tên unit dành riêng cho repo này: `aurora-waf-controller`, `aurora-waf-nginx`.
Không chạy đồng thời hai checkout với cùng unit names/ports.

Chỉ chạy UI/API bằng systemd, không cần NGINX: `make run-controller`.
Chỉ chạy data plane: `make run-nginx`. Hai unit không phụ thuộc lifecycle của nhau.
Dừng riêng Go: `systemctl --user stop aurora-waf-controller.service`.
Các unit được tạo transient bằng `systemd-run --user`, không phải system-wide service.

| URL | Hành vi |
| --- | --- |
| `http://127.0.0.1:8080/` | React UI nhúng, Go phục vụ trực tiếp |
| `http://127.0.0.1:8080/api/v1/status` | Management API trực tiếp từ Go |
| `http://127.0.0.1:8080/readyz` | SQLite schema ledger đọc được |
| `http://127.0.0.1:8090/ok` | Demo data plane allow → 200 |
| `http://127.0.0.1:8090/__aurora_blocked` | Demo data plane block → 403 |

```bash
make status
make smoke
make stop
# Khi đã stop, build lại rồi chạy:
make run
```

`make run` yêu cầu artifacts có sẵn và không thay thế unit đang chạy; muốn restart
toàn stack dùng `make stop` rồi `make run`. Nếu một bước startup thất bại, xem
`make status`/journal, dừng unit đã khởi động rồi sửa lỗi trước khi thử lại.
Readiness retry có giới hạn; không tự bỏ qua database/config failure.

## Config và dữ liệu

NGINX config: [deploy/nginx/nginx.conf](../deploy/nginx/nginx.conf). Chạy `make nginx-check`
để validate với repo root làm prefix. Bare `nginx -t` vẫn tìm `/etc/nginx/nginx.conf`
theo build defaults của package, không phải config Aurora.

SQLite: `control-plane/data/aurora.db`; stop/restart giữ dữ liệu. Logs và temporary
buffers: `build/runtime/`. Không xóa database để restart stack.
Controller logs: `journalctl --user -u aurora-waf-controller`; NGINX logs:
`build/runtime/nginx-error.log` và `build/runtime/nginx-access.log`.

Workflow owner là local runner trong Makefile. Authority là config được version
control và binary đã build. Durable boundary là SQLite file; process lifecycle do
systemd user quản lý. Invariant: management API chỉ bind loopback, không liên kết
readiness management với WAF enforcement và không chiếm cổng dịch vụ hiện có.

## Policy và module

`build/modules/ngx_http_aurora_waf_module.so` là module nạp bằng `load_module`;
Rust liên kết static bên trong. Policy active: `build/runtime/active-policy.json`,
khởi tạo một lần từ `examples/runtime-policy.json` bằng `make rules-init`.
Rules API + compiler/activation mới: [RULES_BACKEND.md](RULES_BACKEND.md).
Sau khi cập nhật policy bằng atomic rename, chạy `make nginx-check`, rồi:

```bash
systemctl --user kill --kill-whom=main --signal=HUP aurora-waf-nginx.service
```

Invalid reload giữ policy trong worker cũ. Đổi code module cần `make stop` rồi
`make run` sau build. Không load `target/release/libaurora_ffi.so` như NGINX module.
Mốc hiện tại có Rules API exact-path, chưa inspect body hoặc SQLi/XSS.

## Verification

Đã pass Go/Rust/C ABI checks, embedded UI và NGINX lifecycle integration. Trực tiếp từ Go:
UI HTML/assets/SPA fallback và API/readiness hoạt động. Dừng controller: demo data
plane vẫn trả 200/403. Controller trả `enforcement_ready: null` vì chưa có node observer.
Stop giải phóng các port; start lại giữ SQLite. Xem runtime doc cho evidence reload/load.
Stack được để chạy trong user session sau khi kiểm tra.
