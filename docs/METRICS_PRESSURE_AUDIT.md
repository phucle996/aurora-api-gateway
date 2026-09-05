# Metrics pressure audit — 2026-09-05

Follow-up implementation and verification: [Metrics fixes](METRICS_FIXES.md).
Findings below describe the pre-fix audit and retain its original evidence.

## Scope and reproducibility

Independent audit of the working tree based on Aurora commit
`c7f2d2a421325e8c6666f2b1ded1993fa6ec33dc`, including the pre-existing uncommitted
NGINX server-config fallback and Prometheus timeline changes. No production fixes
were implemented by this audit. Test fixtures and opt-in failing regression tests
are separate from application code.

Trunks was cloned from [upstream](https://github.com/tsenart/trunks) at
`ec8df2c5cc4ea61af0471b04cfe54eeacdc7a63b` and built as version 0.2.0. Installed
binary: `/home/phucle/.local/bin/trunks`; source: `/tmp/aurora-trunks-review-20260905`.
Upstream Cargo.lock still named its two workspace packages 0.1.2; `--locked`
therefore failed. Building updated only those package versions to 0.2.0, with no
third-party dependency changes. The actual report flag is `--report-type`, not the
README's `--type`.

Commands (from repository root; installed NGINX, Prometheus and Trunks required):

```bash
make module
cd control-plane
go build -buildvcs=false -o ../build/aurora-controller-perf ./cmd
go test -race -count=1 ./...
AURORA_METRICS_AUDIT=1 go test -race -count=1 -v ./internal/test/integration -run TestAudit
cd ..
node scripts/test-metrics-pressure.mjs
AURORA_PRESSURE_PROFILE=burst node scripts/test-metrics-pressure.mjs
AURORA_PRESSURE_PROFILE=read-pressure node scripts/test-metrics-pressure.mjs
AURORA_PRESSURE_PROFILE=nginx-baseline node scripts/test-metrics-pressure.mjs
```

The audit tests intentionally return nonzero for violated invariants. They are
opt-in so existing tests do not hide the failures behind weakened assertions.
The SQL authority-interleaving test uses a private scheduling gate around REAL
SQLite commits, not a fake storage implementation.

All load fixtures use unique loopback ports, private temporary token/config/DB,
an independent Prometheus process and TSDB. They never replace the installed
Prometheus configuration, reload its systemd service, mutate the live database,
or signal the live NGINX. Only fixture-owned processes receive test signals.
Artifacts live in `build/perf/metrics-*/results.json`, per-stage Trunks reports,
process logs and fixture DB. The fixture directory is private; do not publish its
token/config/target files. Full raw per-request traffic is streamed through the
validator and reporter rather than retained unbounded on disk.

## Workload and interpretation

- Four NGINX workers, 4096 worker connections, 512 exact block paths.
- HTTP/1.1 loopback, keepalive, 90% allowed `/ok` (exact body `ok\n`), 10% blocked
  `/blocked` (403 expected). No proxy/backend latency, TLS, body inspection or
  regex workload. This exercises the current executable engine, not future WAF
  capabilities.
- Trunks starts 64 workers, maximum 512, request timeout 2 seconds; Tokio threads
  capped at four. Reporter uses two threads. Generator and system under test
  share this desktop with other applications; results are NOT production capacity
  certification or a comparison against a dedicated remote generator.
- Standard profile per mode: 5k RPS/10s, 20k/20s, 50k/20s, 20k/70s with four
  validated graceful reloads of the same policy, 20k/15s with dependencies paused
  for six seconds. This does not prove correctness of concurrent policy mutations.
- Burst profile targets 100k and 200k RPS for 20s each. Requested rate must be
  compared with actual report rate; overload cannot be inferred from the flag.
- Read profile adds 500 timeline reads/s concurrently with 20k data-plane RPS.
- Plain NGINX baseline removes the Aurora module entirely and returns the same
  403 at `/blocked`, repeating the reload experiment with the same generator.
- Every response is checked against its URL. Trunks reports ~90% HTTP success
  because it counts intended 403 blocks as failures; our mismatch count is the
  correctness criterion. Its `throughput` also excludes those 403s: use `rate`
  and request count when discussing total traffic.
- Trunks latency values are nanoseconds. Resources are `/proc` samples, not the
  application metrics whose correctness is being audited. Short reload tests do
  not establish long-term memory leak freedom or bounded generation backlog.

## Confirmed correctness findings

### P1 — Active metrics mode can disagree with durable configuration

`metricsService.SaveConfig` commits SQLite before acquiring the provider mutex.
Request A can commit standalone and pause, B commit disabled and activate it,
then A activate standalone. The durable mode remains disabled. Deterministic
concurrency audit reproduced exactly that state; Go race detector cannot detect
this logical ordering violation. Owner must serialize/CAS the durable and active
transition and settle retries against the committed authority.

### P1 — Standalone rollup lifetime is bound to the settings HTTP request

`activeProvider.Start(ctx)` receives the request context. net/http cancels it when
the PUT response finishes, terminating the minute rollup and cleaner goroutines.
Pushes still append to RAM. Audit after 65 seconds: 60 ring samples, zero SQLite
history rows. The full HTTP pressure run independently reproduced zero rows after
the 70-second stage. The rollup bucket is not capped, so its growth is not bounded
by the 60-point display ring when the background worker stops. A mode switch may
flush retained points, which does not prove periodic durability worked.

### P1 — Stale heartbeat remains Ready in every mode

Repository writes `datetime(..., 'unixepoch')`, yielding `YYYY-MM-DD HH:MM:SS`.
Node service parses only RFC3339; on failure it skips the >45s offline transition.
Real SQLite + service audit with a two-minute-old heartbeat returns Ready for
disabled, standalone and prometheus. A test accepting Ready immediately after
startup misses this failure mode.

### P1 — Exporter counters are not node-wide across NGINX workers

Rust static atomics are process-local. Each worker serves the same node/action
label set with its own counter; worker 0 alone sends heartbeat RPS. A scrape can
hit a different worker, so the series can decrease without restart and heartbeat
RPS undercounts node traffic. COW preserves isolation, not shared counter state.
Node-wide metrics need an explicitly owned aggregation/shared-memory contract,
or distinct worker/generation labels with correct aggregation.

### P1 — Prometheus timeline contains misleading measurements

Exporter resets CPU sampling history to zero on every scrape, so the fallback
5.0 is emitted instead of a CPU delta. Provider queries only the CPU series and
fills CPU alone; memory, connections and RPS remain struct-default zero. Native
heartbeat itself hardcodes active connections to zero. A nonempty timeline and
HTTP 200 therefore do not prove measurement correctness. Missing measurements
must not be fabricated as zero.

Configured Prometheus job is not used in the selector, and only the first result
series is consumed. The read-pressure profile saved job `this-job-does-not-exist`
against real Prometheus and still received two points from the pressure job.
Multiple jobs/instances sharing a node_id are therefore not safely disambiguated.

## Results

Host: 12 logical CPUs, about 31 GiB RAM, Linux 7.0.0-30-generic. NGINX 1.30.4,
Prometheus 2.54.1 (the user's installed binary, not a claim of latest stable).

### Standard profile

Evidence: [results.json](../build/perf/metrics-6ZQTI4/results.json). 422.7 seconds
including setup/recovery; 9,449,985 load requests. No wrong returned allow body or
observed wrong allow/block HTTP status among completed responses. 13 transport
failures, all in the reload stages; no worker crash/connection-limit log errors.

| Mode | Actual steady RPS | p99 at 50k (ms) | Errors during 70s reload / requests | Errors while dependencies paused |
| --- | ---: | ---: | ---: | ---: |
| disabled | 50,000 | 0.076 | 5 / 1,399,999 | 0 / 299,999 |
| standalone | 50,000 | 0.100 | 4 / 1,399,999 | 0 / 299,999 |
| prometheus | 50,000 | 0.176 | 4 / 1,399,999 | 0 / 299,999 |

Errors were connection reset/connection closed before message completed. Each
mode's steady 5k, 20k and 50k stages had zero mismatches. Pausing dependencies is
six seconds within a 15-second stage, not the full 15 seconds. Mode restart and
hydrating already-flushed history passed; this does not negate the failed periodic
rollup gate. Standalone had zero persisted rows before switching away; the switch
then flushed one row, explaining why later restart hydration can pass.

### Higher offered load

Evidence: [results.json](../build/perf/metrics-wWGyhn/results.json). 7,527,213
requests, zero status/body/transport mismatches in all six stages.

| Mode | Offered 100k: actual RPS / p99 ms | Offered 200k: actual RPS / p99 ms |
| --- | ---: | ---: |
| disabled | 64,075 / 0.136 | 62,135 / 0.216 |
| standalone | 63,024 / 0.155 | 62,642 / 0.151 |
| prometheus | 62,696 / 0.165 | 61,789 / 0.192 |

This did NOT deliver 100k/200k RPS. During the run Trunks consumed about four CPU
cores; Node result validation approached one core, with each NGINX worker around
0.26 core. Trunks processes peaked around 1.1 GiB RSS, versus ~7 MiB per NGINX
worker. Do not attribute the generator's memory to WAF or infer a WAF throughput
ceiling from this generator/reporting configuration.

### Concurrent timeline readers

Evidence: [results.json](../build/perf/metrics-FtQZyR/results.json). 1,229,996
combined data-plane and timeline requests, zero unexpected status/transport/body
results. Per mode: ~400,000 WAF requests plus ~10,000 timeline reads in 20 seconds.

| Mode | Timeline actual RPS | Timeline p99 (ms) | WAF p99 with readers (ms) |
| --- | ---: | ---: | ---: |
| disabled | 500 | 0.179 | 0.079 |
| standalone | 500 | 0.510 | 0.707 |
| prometheus | 500 | 2.183 | 0.154 |

Disabled timeline 503 is expected, not an unexpected server error. HTTP success
in other modes is independent of the data-accuracy failures described above.

### Plain NGINX control experiment

Evidence: [results.json](../build/perf/metrics-HxYlN4/results.json). Aurora module
was not loaded. Offered 100k and 200k RPS yielded 69,785 and 63,368 actual RPS,
respectively, with no request errors. The 20k/70s reload stage had 9 transport
errors in 1,399,999 requests and no crash. Thus neither the high offered-rate
shortfall nor connection resets during reload uniquely implicates Aurora.
Investigate idle keepalive/reload/client transport behavior before assigning root
cause. Do not mask this by adding blanket retries to non-idempotent requests.

Across completed profiles: **22,270,256 requests**, comprising 18,207,194 across
Aurora profiles (including 29,999 timeline API reads) and 4,063,062 in the plain
NGINX control. Aurora profiles had 13 transport errors, control had 9; all were in
reload stages. No completed response was observed violating expected URL status
or allowed-body content. That is bounded-test evidence, not proof of zero bugs.

### Diagnostic evidence

All 40 final exporter CPU samples were exactly 5.0. Fresh-connection scrapes
crossing worker PIDs showed two decreasing node-counter transitions without a
reload in that sampling interval. At 50k real RPS, heartbeat node RPS often showed
6k–17k, approximately a single worker's share. Prometheus timeline CPU stayed 5,
while memory/RPS/connections were zero despite the exporter showing nonzero RAM.

Existing `go test -race -count=1 ./...` passed. The deeper opt-in audits failed on
durable/active mode disagreement, canceled rollup lifetime and stale Ready in all
three modes; [raw Go output](../build/perf/metrics-audit-tests.log). These are
logical correctness failures even though the race detector did not report a data
race. Operationally, enforcement, transport continuity, metrics accuracy and
durable control-plane behavior are separate acceptance gates.

## Handoff / remaining gates

Only audit code, Make test targets and this report were added. Existing user
changes were preserved; production metrics implementation was not patched. Fix
the confirmed lifecycle/authority/liveness and measurement issues before claiming
the three modes production-ready. Repeat the same regression and pressure suites
after fixes, then use a separate load-generator host, longer hours-scale soak,
TLS/HTTP2/backend/body workloads, many-node/cardinality bounds, slow storage and
disk-full/crash injection. None of those broader gates was certified here.

Early `metrics-hkPmnf` and `metrics-jPAZIo` folders are discarded harness setup
attempts (logging bug and upstream CLI flag mismatch), excluded from the request
totals above. Successful pressure execution can still exit 1 because the audit
correctly records failed invariants; check `fatal` separately from `checks` and
per-stage mismatches in results.json.

Final cleanup verified no fixture controller/NGINX/Prometheus processes remained.
The three original systemd user services stayed active: controller `/readyz` OK,
Prometheus ready, live NGINX `/ok` 200 and `/__aurora_blocked` 403. Fixture artifacts
are retained for inspection, not silently deleted.
