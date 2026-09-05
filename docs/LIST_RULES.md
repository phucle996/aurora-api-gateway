# Security Rules — list and statistics

## Workflow ownership

ListRules owns query, flat item/result, service and repository ports. RuleStats
owns separate query/result/service/repository ports. Both are authenticated,
read-only management workflows; SQLite is authority, not mock UI records, NGINX
traffic or another workflow's result. No mutation, publication or reload occurs.

List uses one CTE statement for filtered total and page, including an empty page.
Statistics uses one CTE statement for current totals, history coverage and baseline
revisions. Each statement observes a consistent SQLite snapshot. List and stats
are separate requests, not a cross-endpoint atomic snapshot. NGINX requests never
wait for either workflow; runtime/FFI/COW contracts are unchanged.

## List contract

`GET /api/v1/rules`: search (literal case-insensitive name substring, max 120 bytes),
group, action, severity, enabled, limit 1..100, after nonnegative ID. Enums are
validated; invalid enum/range returns 422 and malformed numeric input 400.

Result: `items`, `total` (all matching rules, independent of cursor), optional
`next_after`. Stable order is numeric ID ascending. One extra row determines next
page; no fabricated page count. Empty items is `[]`, including beyond the last ID.
Keyset pages are live reads: concurrent edits can change membership between pages;
there is no frozen multi-page export guarantee.

UI supports search, combined filters, first/next page, selection and refresh.
Badge says “N shown / M matching”, not a global total based on current page length.
Inert sort/menu controls are removed. The list page uses a neutral header instead
of the shared prototype's hardcoded cluster-health/controller/node counts.
Rows are keyboard-selectable. Filtering cannot leave an unrelated selected detail.

## Statistics and monthly comparison

`GET /api/v1/rules/stats` returns current `total`, `enabled`, `log`, `block` across
ALL saved rules, independent of table filters. Log/block count enabled definitions,
not traffic events, detection volume or rules acknowledged as active by NGINX.

Additional flat fields: `as_of` (server read-request UTC timestamp),
`comparison_before` (start of current calendar month UTC), `history_available`,
nullable `total_delta`, `enabled_delta`, `log_delta`, `block_delta`.

Delta = current inventory count minus inventory immediately before that boundary
(end of previous month). Each rule contributes only its highest revision strictly
before the boundary. Editing action or enabled status changes the current bucket,
not past history. This is NOT count of edits, month-to-date creations versus a full
previous month, a percentage, or a rolling 30-day comparison. Negative and zero
deltas are meaningful. UTC avoids browser-timezone-dependent results.

History coverage starts when migration 2 established rules and immutable revision
tracking. If that timestamp is after the comparison boundary (or unavailable),
all deltas are null; UI says “Insufficient history for last-month comparison”. A
new installation must not invent an empty historical baseline. This relies on the
supported workflows preserving revision history; arbitrary external DB imports or
manual destructive edits are not a supported source of historical statistics.

## Failure and verification

Bearer/origin boundary and no-store apply to both endpoints. Failure shows an
error and retry; stale totals are cleared rather than presented as current or zero.
Abort/response guards prevent superseded requests from replacing newer results.
No background retry writes, durable job, settlement or new migration is needed.

`make create-rule-test` includes browser list checks against isolated real API/DB:
55 additional records, filters, pagination/counts, empty results, global statistics,
unknown history, request failure and recovery. Go race tests cover filter enums,
cursor boundaries, literal search, read auth, exact UTC month/leap/year boundaries,
historical revision selection, positive/negative/zero deltas and missing coverage.
Live DB is never seeded with test data.
