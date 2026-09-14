# Spec synchronization and recovery

## Authority and transport

The control plane compiles database authority into spec releases through [SpecScheduler](../control-plane/internal/provider/spec_scheduler.go). Extension instances are resolved against the versioned [manifest catalog](../control-plane/internal/extensionmanifest/catalog.go).

The agent performs periodic gRPC `SyncSpec` calls and reports results through `ReportSpec`. This is not a server-pushed, bidirectional spec stream. Its interval comes from agent configuration. Compose explicitly sets the gRPC endpoint to `controller:9099`; the standalone default is port `9090`.

## Wire document

The source of truth is the agent's [Spec schema](../crates/agent/src/spec/schema.rs). `version` is numeric; `extensions` is an array of [extension instances](../crates/agent/src/spec/extensions.rs), not a dictionary of arbitrary plugin keys. Each instance carries `instance_id`, `key`, `version`, `renderer`, `manifest_digest`, and a JSON-encoded `config_json` string.

For illustration, a std-log instance has this shape (the digest placeholder must be supplied by the controller):

```json
{
  "instance_id": "std-log",
  "key": "builtin/std-log",
  "version": 1,
  "renderer": "std-log",
  "manifest_digest": "<controller-supplied digest>",
  "config_json": "{\"enabled\":true,\"format\":\"json\",\"split_streams\":true,\"log_level\":\"info\",\"include_waf_details\":true}"
}
```

The payload checksum is carried by the sync response; it is not a `digest` field in the root JSON schema. Configure extensions through the management API or console rather than editing the generated document.

## Agent application order

[SpecSyncRunner](../crates/agent/src/sync/spec.rs) applies a changed response in this order:

1. Verify the response checksum when supplied and parse the spec.
2. Write a temporary file and rename it to `policy_dir/node-spec.json`.
3. Materialize policy files, upstreams, routing, certificates, extension directives, module includes and L4 configuration.
4. If NGINX files changed and NGINX management is enabled, run its configuration test and request a reload.
5. Apply agent extension workers through the dispatcher.
6. Advance the in-memory hash and report `in_sync`.

A failure reports `out_of_sync` and does not advance the in-memory hash. Transport errors are retried on subsequent cycles. Bootstrap reads the saved `node-spec.json` and runs activation before marking that hash current.

## Durable and failure boundaries

The cached spec is written **before** activation. It represents a received desired state, not proof of a successful deployment. A failed activation may leave new files on disk while existing NGINX workers retain their old configuration. File writes use content comparison and atomic rename individually; there is no transaction covering all files and no automatic full-directory rollback in this runner.

A successful reload command does not prove all workers have switched generation. The sync report also does not prove that a remote telemetry collector accepted data. Operators should inspect NGINX errors and exporter behavior separately.

## Extension ownership

NGINX renderers materialize configuration and policies. Prometheus, OpenTelemetry Metrics, OpenTelemetry Logs and std-log have explicit agent worker lifecycles. Disabling one exporter does not disable the other exporters. Logs use bounded queues and bounded shutdown attempts; delivery is best-effort.

## Inspect a Compose node

```bash
docker compose logs --tail=100 node
docker compose exec node cat /var/lib/aurora-policy/node-spec.json
docker compose exec node cat /var/lib/aurora-policy/active-extensions.conf
docker compose exec node cat /var/lib/aurora-routing/active-domain-routing.conf
```

Generated configuration can contain sensitive material. Use the runtime paths configured for the actual deployment. See [observability.md](observability.md) for metrics and logs.
