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

Directives: `gateway on|off`, `gateway_access_policy`, `gateway_jwt_policy`, `gateway_rate_limit_policy`, `gateway_metrics`.
Input is normalized URI; errors return HTTP 503; rate limiting returns HTTP 429 with `Retry-After`. `satisfy any` is rejected when enabled.



## Access logs and exporter integration

The [Docker node template](../../deploy/docker/nginx-node.conf.template) uses JSON syslog over `/dev/shm/aurora_access.sock`, gated by `$gateway_log_active`. The agent's log consumers control that flag through shared memory.

A custom NGINX configuration must explicitly include the equivalent log directives; enabling an agent exporter alone does not change arbitrary NGINX templates. Request duration from `$request_time` is in seconds. See [observability](../../docs/observability.md) for consumer lifecycles and delivery limits.
