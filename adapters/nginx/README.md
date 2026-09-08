# NGINX Dynamic Module

Includes `ngx_http_aurora_waf_module.c`, NGINX build config, ABI header, and C test harness.
The module uses a statically linked Rust runtime, verified and loaded on NGINX 1.30.4 (Ubuntu 24.04/Linux amd64).

```bash
make module
make nginx-check
make module-test
```

Artifact: `build/modules/ngx_http_aurora_waf_module.so`, loaded via `load_module`.
The standalone `libaurora_ffi.so` is intended exclusively for the ABI test harness; do not load it as an NGINX module.

Directives: `aurora_waf on|off`, `aurora_waf_policy <JSON file>`,
`aurora_waf_mode enforce|audit` in http/server/location contexts. Input is normalized URI;
body inspection, SQLi/XSS detectors, and subrequest protection are in progress. An enabled state with an invalid or missing
policy rejects the configuration on startup; evaluation errors return HTTP 503. `satisfy any` is rejected when enabled.

Builds pin upstream source archives against verified checksums. Even with `--with-compat`, PCRE
signatures must remain host-compatible; run `nginx -t` against the target binary before activation.
Policy updates use graceful reload; updating module binaries requires a full process restart.

See [runtime contract](../../docs/RUNTIME.md), [FFI](../../docs/FFI.md),
and [local runner](../../docs/LOCAL_RUN.md).
