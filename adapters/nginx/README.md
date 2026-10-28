# NGINX Gateway Dynamic Module

Includes modular C adapter sources (`src/`, `src/extensions/`), NGINX build config, ABI headers, and C test harness.
The module integrates with the Rust engine runtime (`libaurora_ffi.a`), verified and loaded on NGINX 1.30.4.

```bash
bash scripts/build-nginx-module.sh 1.30.4
node scripts/test-nginx-module.mjs
```

Artifact: `build/modules/ngx_http_gateway_module.so`, loaded via `load_module`.

### Gateway Phase-Driven Architecture
- **Module Core**:
  - `src/module.c`: Process lifecycle, Shared Memory (SHM) policy synchronization, and polymorphic engine binding.
  - `src/pipeline.c`: Unified HTTP Access Phase hook (`aurora_gateway_phase_access`). Single straight-line FFI dispatch for all ingress security & routing rules.
  - `src/telemetry.c`: NGINX variables and Log Phase hook (`aurora_gateway_phase_log`).
- **Phase Integration**:
  - **Access Phase**: Dispatches request metadata stack to Rust `AccessPhaseSpace` (< 35ns).
  - **Background Phase**: Hands off completed request metadata to companion Shadow Worker thread (`aurora-shadow-{id}`, `SCHED_IDLE`).
  - **Metrics**: Sub-microsecond Prometheus scrape endpoint (`location = /metrics { gateway_metrics; }`).

Directives: `gateway on|off`, `gateway_metrics`. Policies are dynamically hot-swapped via Shared Memory (`/dev/shm/aurora_gateway_policy.bin`).



## Access logs and background telemetry

Access logs, traces, and metrics are captured in-process at `NGX_HTTP_LOG_PHASE` by `ngx_http_gateway_log_handler` and dispatched via `aurora_gateway_phase_log` to the companion Shadow Worker thread (`aurora-shadow-{id}`, `SCHED_IDLE`). Logs are rendered using zero-allocation pre-templated byte blitters and flushed during CPU idle periods, eliminating Unix Domain Socket IPC overhead. See [observability](../../docs/observability.md) for details.
