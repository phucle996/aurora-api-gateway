# NGINX dynamic module

Đã có `ngx_http_aurora_waf_module.c`, NGINX build config, ABI header và C harness.
Module dùng Rust runtime liên kết static, đã load trên NGINX 1.30.4 Ubuntu 26.04 amd64.

```bash
make module
make nginx-check
make module-test
```

Artifact: `build/modules/ngx_http_aurora_waf_module.so`, dùng với `load_module`.
`libaurora_ffi.so` riêng chỉ phục vụ ABI harness; không nạp nó như NGINX module.

Directives: `aurora_waf on|off`, `aurora_waf_policy <JSON file>`,
`aurora_waf_mode enforce|audit` trong http/server/location. Input là normalized URI;
body, SQLi/XSS và subrequest protection chưa triển khai. Enabled + invalid/missing
policy reject config; lỗi evaluate trả 503. `satisfy any` bị reject khi enabled.

Build pin source upstream và checksum đã xác minh. `--with-compat` vẫn cần PCRE
signature tương thích host; chạy `nginx -t` với binary đích trước activate.
Policy update dùng graceful reload; đổi module binary cần full restart.

Xem [runtime contract](../../docs/RUNTIME.md), [FFI](../../docs/FFI.md)
và [local runner](../../docs/LOCAL_RUN.md).
