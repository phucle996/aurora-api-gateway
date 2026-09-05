# Create Rule — shipped workflow

React form → authenticated `POST /api/v2/rules` → SQLite transaction → real list,
detail and history. No Blueprint. Go embeds React and serves it directly on :8080
under systemd; NGINX remains only the data plane.

## Ownership and durable boundary

CreateDefinition owns its command/result/service/repository ports. SQLite is the
management authority. One transaction writes rule, revision 1, immutable full
definition and idempotency receipt. Failure rolls everything back. Reads have
their own flat projections; create never calls detail/list or activation.

`Idempotency-Key` (16–128 characters) identifies a submission. Same key and decoded
payload returns the original result; different payload returns 409. Concurrent
identical submissions create one record. The browser freezes uncertain submissions
and retries the same key/payload after lost responses. This recovery is within the
current page session, not durable across closing/reloading the browser.

Migration 4 is additive to existing rules/releases/journals. Full definitions and
revisions are immutable. Legacy PUT rejects extended definitions rather than
dropping fields. Editing, revision diff and rollback need their own workflow.

## HTTP contract

Bearer token and same-origin checks are required. React retains the credential in
memory only, never localStorage/sessionStorage or the embedded bundle. Unlock with
the operator token from `control-plane/data/admin.token`; do not share this file.
This is single-operator authentication, not sessions/RBAC.

Example request (Content-Type application/json, plus Idempotency-Key):

```json
{
  "name": "Protect admin", "description": "Exact-path protection",
  "group": "endpoint", "severity": "high", "score": 5,
  "enabled": true, "priority": 100, "policy_id": null,
  "logic_mode": "all",
  "conditions": [{"field": "path", "operator": "equals", "value": "/admin", "header_name": ""}],
  "action": "block", "response_code": 403, "custom_response": "",
  "log_event": false, "add_to_reputation": false,
  "source_ip": "", "host_domain": "", "path_prefix": "", "http_method": ""
}
```

201 response: `{"id":"2","version":1,"state":"saved","runtime_ready":true,"runtime_issues":[]}`.
Location points to `/api/v1/rules/2`. 400 malformed/unknown JSON fields; 401 invalid
credential; 403 origin; 409 idempotency conflict; 413 body limit; 415 media type;
422 validation with field-keyed errors. Request size is bounded to 64 KiB.

Conditions: 1–16, ordered, logic all/any. Fields uri_raw/path/query/header/body/
client_ip/method; operators equals/contains/starts_with/ends_with/regex/cidr.
Header requires a token-valid header_name; CIDR only targets client_ip. Regex syntax
is validated using Go regexp (no lookaround/backreferences), 1024 bytes per regex,
4096 combined. This is definition validation, not runtime execution validation.
Source IP scope accepts comma-separated addresses/CIDRs, host is an ASCII hostname,
method is an explicit enum. Policy binding remains unassigned.

Actions allow/log/block. Block accepts 400/403/429/500 and up to 512 response
characters; other actions reject response overrides. CAPTCHA/rate-limit are not
implemented. HTTP 429 alone is not a rate limiter. Event/reputation options are
preserved as intent but explicitly reported unavailable at runtime.

## Isolation from active traffic

Saving does not compile/publish/reload or modify the active policy file. Full
conditions/scopes/options round-trip in detail even when runtime_ready=false.
Publishing rejects any enabled unsupported definition; it never silently reduces
it to an exact-path rule. Supported subset: one canonical path/equals predicate,
allow/log/default 403 block, no scopes or unsupported side effects.

Existing Rust/FFI immutable snapshots and worker process COW are unchanged. They
never query Go/SQLite on the request path. NGINX config validation remains an
activation gate before reload, separate from Create. See [activation and recovery](RULES_BACKEND.md#atomic-activation--recovery)
for the existing staged-file/restore limitations; saved is not published/applied.

## Verification

```bash
make create-rule-test
make rules-test
```

Use repo-pinned Node/npm. Browser tests use playwright-core and installed Google
Chrome (`CHROME` override), a temporary SQLite database and controller on a
free port, not the live database. They check authentication, invalid regex, full
field round-trip, lost response after commit, same-key retry/no duplicates, safe
text rendering, publish rejection and persistence across process restart.
Screenshot: `build/create-rule-browser.png`.

Go integration tests check immutable rows, transaction rollback via injected SQL
failure, 20 concurrent duplicate submissions, field validation and legacy-update
protection. Existing runtime tests cover real NGINX generations under traffic;
these are bounded correctness tests, not sustained-load production certification.

The private browser fixture startController helper only manages repeated process
restart/cleanup for this test; it is not a shared application abstraction.

## Local handoff — 2026-09-05

Controller service rebuilt/restarted with embedded UI. Live database upgraded from
3 to 4 after stopping Go and backing up the checkpointed database to
`control-plane/data/aurora.before-create-v2-20260905.db`. Existing demo rule/revision
and ready release 1 preserved; no test definitions inserted into the live database.
NGINX was not restarted/reloaded: active snapshot digest unchanged, generation 1,
`/ok` 200 and `/__aurora_blocked` 403 verified after the controller upgrade.

Passed: `make create-rule-test`, full Go race suite with real compiler/NGINX/module
environment, Rust fmt/clippy/tests and C → Rust FFI smoke. Vite still reports a
large-bundle warning; unrelated page splitting is outside this workflow.
