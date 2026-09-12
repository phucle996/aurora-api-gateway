# NGINX Gateway Dynamic Module

Includes modular C adapter sources (`src/`, `src/extensions/`), NGINX build config, ABI headers, and C test harness.
The module integrates with the Rust engine runtime (`libaurora_ffi.a`), verified and loaded on NGINX 1.30.4.

```bash
bash scripts/build-nginx-module.sh 1.30.4
node scripts/test-nginx-module.mjs
```

Artifact: `build/modules/ngx_http_gateway_module.so`, loaded via `load_module`.

### Gateway Architecture & Extensions
- **Module Core**: `src/module.c`, `src/pipeline.c`, `src/telemetry.c`
- **Extensions**:
  - `src/extensions/access.c` (`gateway_access_policy`)
  - `src/extensions/jwt.c` (`gateway_jwt_policy`)
  - `src/extensions/rate_limit.c` (`gateway_rate_limit_policy`)
  - `src/extensions/waf.c` (`gateway_waf_policy`, `gateway_waf_mode`)

Directives: `gateway on|off`, `gateway_waf_policy`, `gateway_waf_mode`, `gateway_access_policy`, `gateway_jwt_policy`, `gateway_rate_limit_policy`, `gateway_metrics`.
Input is normalized URI; errors return HTTP 503; rate limiting returns HTTP 429 with `Retry-After`. `satisfy any` is rejected when enabled.


