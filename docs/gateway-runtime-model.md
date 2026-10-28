# Gateway runtime model

This document describes implemented ownership boundaries. The authoritative phase ordering and supported hooks are in [the NGINX pipeline](../adapters/nginx/src/pipeline.c) and [adapter extension sources](../adapters/nginx/src/extensions).

## Request path

NGINX handles connections, virtual-host/location selection and proxying. The gateway module runs configured access/security checks through its C adapter and Rust FFI. Supported policies can reject requests before they reach an upstream. Response behavior depends on the active configuration and extension implementation.

A conceptual request path is:

```text
Client -> NGINX routing/rewrite -> configured access checks -> upstream
                              -> early rejection             |
Client <---------------- response filters <------------------+
                              |
                       completion telemetry
```

This is an orientation diagram, not a promise that every proposed rewrite, body-filter, AI or authentication capability is available. Consult the [manifest catalog](../control-plane/internal/extensionmanifest/manifests) and each renderer before enabling a feature.

## Configuration path

The control plane owns desired configuration. The agent periodically retrieves a spec, materializes local files and requests NGINX reload when needed. Reloads may create new workers while old workers finish active requests. See [spec synchronization](spec-sync-architecture.md) for checksum, caching, activation and recovery semantics.

## Observability path

Live in-flight requests and early rejections are tracked at Ingress via cacheline-aligned L1 Core-Local metrics (< 1ns). At Egress (`NGX_HTTP_LOG_PHASE`), request metadata is handed off non-blocking to the in-process companion Shadow Worker (`aurora-shadow-{id}`, `SCHED_IDLE`) via a bounded channel (< 40ns). The Shadow Worker formats pre-templated JSON access logs and maintains pre-computed zero-allocation Prometheus and OTLP wire buffers. NGINX exposes `/metrics` directly with sub-microsecond response latency (< 500ns). Out-of-process UDS IPC (`/dev/shm/aurora_access.sock`) has been completely decommissioned.

Log export does not provide durable audit delivery or a zero-overhead guarantee. Queues can overflow and exporters can fail. See [observability.md](observability.md) for current limits and configuration.
