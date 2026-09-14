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

NGINX completion counters are read from shared memory. Its configured access log sends JSON via a Unix datagram socket when `$gateway_log_active` is true. Agent subscriptions feed std-log and OTLP log workers; Prometheus and OTLP metrics read counters separately.

Log export does not provide durable audit delivery or a zero-overhead guarantee. Queues can overflow and exporters can fail. See [observability.md](observability.md) for current limits and configuration.
