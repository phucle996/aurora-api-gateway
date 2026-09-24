# Sub-skill 11: Observability & Telemetry Testing (Tracing, Metrics & Log Safety)

> **Core Mission**: Validate distributed trace propagation (W3C Traceparent), prevent metric cardinality explosion, audit structured log sanitization against injection attacks (CRLF, ANSI escape codes, null bytes), and ensure telemetry does not leak sensitive secrets without relying on hardcoded file paths or fragile workflow names.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Dynamically locate loggers, metrics collectors, and distributed tracers across the codebase:
- **Logging Subsystems**:
  - Go Structured Loggers: `grep -E "(zap\.Logger|slog\.|logrus|zerolog)"`.
  - Rust Tracing / Log Crates: `grep -E "(tracing::(info|warn|error|debug)|tracing_subscriber)"`.
  - Log Formatters & Writers: `grep -E "(NewJSONEncoder|console_subscriber|fmt::layer)"`.
- **Metrics Registries**:
  - Prometheus Collectors: `grep -E "(prometheus\.NewCounter|prometheus\.NewHistogram|metrics::counter)"`.
  - Label Assignments: `grep -E "(WithLabelValues|labels!\()"`.
- **Distributed Tracing (OpenTelemetry)**:
  - Trace Context Extraction: `grep -E "(propagation\.TraceContext|w3c|traceparent)"`.
  - Span Creation: `grep -E "(tracer\.Start|tracing::span)"`.

---

## 2. Smell Paths Audit (Observability Anti-Patterns Checklist)
When surveying telemetry implementations, audit for these dangerous failure paths:
- [ ] **High Cardinality Metric Explosion**: Inserting unbounded dynamic inputs (e.g., user IDs, session tokens, raw URL paths `/items/{uuid}`) directly into Prometheus label values. This creates millions of metric time series, causing memory exhaustion in the gateway and crashing downstream Prometheus servers.
- [ ] **Log Injection via CRLF (`\r\n`)**: Emitting unescaped user inputs directly into log outputs. An attacker sending `\r\n{"level":"info","msg":"User authenticated as admin"}` injects fake audit entries into structured log pipelines.
- [ ] **Terminal ANSI Escape Code Injection**: Failing to strip ANSI terminal escape codes (`\x1b[2J\x1b[H`) from log fields, allowing hostile inputs to clear terminal screens or manipulate operator consoles.
- [ ] **Trace Context Dropping / Disconnected Spans**: Failing to extract and propagate the incoming `traceparent` HTTP/gRPC header into downstream requests, resulting in orphaned trace trees and blind spots during production incidents.
- [ ] **Unchecked Metric Mutation (`NaN` / `Inf`)**: Recording floating-point `NaN` or `+Inf` values into Prometheus Gauges or Histograms, corrupting metric scraper state and generating invalid exposition formats.
- [ ] **PII & Credential Leakage in Telemetry**: Logging raw `Authorization`, `Cookie`, or token parameters in debug or error logs without explicit masking or sanitization.

---

## 3. Rich Candidate Catalog: Telemetry Edge Cases & Hostile Vectors

> [!TIP]
> **ANTI-DOGMATISM: SELECT VECTORS MATCHING THE TELEMETRY CHANNEL:**
> If testing a Prometheus metrics counter, focus on high cardinality and NaN values; do not test W3C traceparent headers. If testing a log formatter, focus on CRLF, ANSI, and null byte injection.

| ID | Telemetry Channel | Hostile Input / Malformed Frame | Targeted Risk / Boundary | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-O01** | **Structured Logging** | `user\r\n{"level":"error","msg":"fake"}` | CRLF Log Injection, log framing breach | Loggers emitting JSON/text to stdout or file | Metric-only components |
| **CAT-O02** | **Terminal Log Escape** | `test\x1b[31;1mCRITICAL\x1b[0m` | ANSI escape code spoofing / terminal wipe | Console loggers, stdout formatters | Machine-parsed JSON lines |
| **CAT-O03** | **Null Byte String Log** | `"auth_failure\x00extra_payload"` | C-string cut-off in log collectors | Native log forwarders, syslog, FFI | Memory-only buffers |
| **CAT-O04** | **Metric Cardinality Flood** | 100,000 unique path requests (`/req/1..N`) | Prometheus time-series explosion (OOM) | Metrics recording HTTP paths or labels | Fixed constant metric labels |
| **CAT-O05** | **Metric NaN / Inf Value** | Record `f64::NAN` or `math.Inf(1)` | Prometheus scraper scrape parse failure | Gauges recording latency or ratios | Integer-only counters |
| **CAT-O06** | **Malformed Traceparent**| `traceparent: 00-malformed_hex_id-00` | Tracing crash, silent trace context drop | OpenTelemetry W3C propagators | Uninstrumented internal tools |
| **CAT-O07** | **Trace Context Propagation**| Send valid `traceparent: 00-4bf92f...-01` | Ensure downstream client inherits trace ID | Reverse proxies, HTTP/gRPC clients | Edge sink endpoints |
| **CAT-O08** | **Oversized Log Message** | 128KB string in single log field | Log buffer exhaustion, I/O thread lock | Log forwarders, UDS log sinks | Fixed-length message fields |
| **CAT-O09** | **PII / Secret Masking** | Request containing `Authorization: Bearer secret` | Ensure token is sanitized to `Bearer [REDACTED]` | Ingress logging, error handler logs | Metrics counters |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                      CONTEXT-AWARE OBSERVABILITY TEST SELECTION                               │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Telemetry Subsystem      │ Mandatory Focus Vectors             │ Irrelevant / Skip Vectors     │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. Structured Logging    │ • CRLF log injection                │ • Metric label cardinality   │
│                          │ • ANSI escape sequence stripping    │ • W3C traceparent headers     │
│                          │ • Secret / PII redaction            │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Metrics & Prometheus  │ • Cardinality limit on route labels │ • CRLF log framing           │
│                          │ • NaN / Infinity gauge values       │ • ANSI terminal codes        │
│                          │ • Counter monotonicity under races  │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. Distributed Tracing   │ • W3C traceparent propagation       │ • Log file rotation          │
│                          │ • Malformed trace header resilience │ • Metric counter overflows   │
│                          │ • Error status recording on 5xx     │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Observability & Telemetry Test Plan: [Target Subsystem]
- **Target Channel**: [Structured Logger / Prometheus Metrics / OpenTelemetry Tracer]
- **Selection Rationale**: [Explain why specific telemetry edge cases were chosen and others skipped]

| Test ID | Telemetry Channel | Hostile Input / Test Vector | Expected Invariant (Assertion) |
|---|---|---|---|
| TC-OBS-01 | Logging | [CAT-O01] CRLF injected into username | Newline escaped as `\r\n`; single JSON line emitted |
| TC-OBS-02 | Metrics | [CAT-O04] 5,000 distinct resource IDs | Aggregated under parameterized template `/res/:id` |
| TC-OBS-03 | Tracing | [CAT-O07] Inbound W3C traceparent | Downstream HTTP call inherits exact trace ID |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored observability test plan with specific telemetry vectors and sanitization assertions.
> - **DO NOT** execute logging fuzzers, trace interceptors, or write test files before receiving user confirmation.
> - Once approved, proceed to execution via `rtk`.

---

## 7. Idiomatic Execution & Scripting

### Go: Log Injection & Trace Propagation Verification
```go
func TestTarget_TelemetrySafety(t *testing.T) {
    t.Run("TC-OBS-01: CRLF Log Injection Escaping", func(t *testing.T) {
        var buf bytes.Buffer
        logger := zap.New(zapcore.NewCore(
            zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
            zapcore.AddSync(&buf),
            zap.InfoLevel,
        ))

        maliciousInput := "user\r\n{\"level\":\"error\",\"msg\":\"fake log injected\"}"
        logger.Info("User login attempt", zap.String("username", maliciousInput))

        output := buf.String()
        // Ensure the entire log is contained within exactly ONE newline-delimited line
        lines := strings.Split(strings.TrimSpace(output), "\n")
        require.Len(t, lines, 1, "CRLF injection caused multiple log lines to be emitted!")
        require.Contains(t, output, "\\r\\n", "Raw CRLF must be escaped into literal string")
    })

    t.Run("TC-OBS-03: W3C Traceparent Header Propagation", func(t *testing.T) {
        var propagatedTraceID string
        downstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            propagatedTraceID = r.Header.Get("traceparent")
            w.WriteHeader(http.StatusOK)
        }))
        defer downstream.Close()

        client := NewTargetProxyClient(downstream.URL)
        ctx := context.Background()
        incomingTrace := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"

        req, _ := http.NewRequestWithContext(ctx, http.MethodGet, downstream.URL, nil)
        req.Header.Set("traceparent", incomingTrace)

        _ = client.Forward(req)
        require.Contains(t, propagatedTraceID, "4bf92f3577b34da6a3ce929d0e0e4736", "Trace ID must propagate to upstream")
    })
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTarget_TelemetrySafety
```

### Rust: High Cardinality Metric & ANSI Stripping
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tc_obs_02_ansi_escape_sanitization() {
        let hostile = "danger\x1b[31mRED\x1b[0m";
        let sanitized = sanitize_log_field(hostile);
        assert!(!sanitized.contains("\x1b["), "ANSI escape codes must be stripped from log fields");
    }
}
```
Run command via RTK:
```bash
rtk cargo test --lib -- tests::test_tc_obs_
```

---

## 8. Diagnostic Reporting Template

```markdown
### Observability & Telemetry Audit Report

- **Target Subsystem**: [Discovered Structured Logger / Metrics Registry / Tracing Layer]
- **Execution Status**: [PASS / TELEMETRY SMELL DETECTED]
- **Sanitization & Safety Outcomes**:
  - `CRLF Injection (TC-OBS-01)`: Input containing `\r\n` serialized as single escaped JSON string $\rightarrow$ [PASS].
  - `ANSI Escape Code Stripping`: Terminal sequences removed prior to stdout emission $\rightarrow$ [PASS].
  - `Metric Label Cardinality`: Verified route metric uses static pattern `/items/:id` rather than raw dynamic values $\rightarrow$ [PASS].
  - `Trace Context Propagation`: W3C traceparent passed to upstream with zero broken spans $\rightarrow$ [PASS].
- **Remediations**: None required.
```
