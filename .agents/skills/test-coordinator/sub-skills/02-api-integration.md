# Sub-skill 02: API & Integration Testing (Protocols, Mismatches & Boundary Framing)

> **Core Mission**: Validate cross-tier communication boundaries (HTTP $\leftrightarrow$ gRPC $\leftrightarrow$ UDS $\leftrightarrow$ Database), detect protocol deserialization mismatches, and verify graceful recovery against disrupted transport frames without relying on fragile workflow names.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Dynamically locate integration endpoints, routers, and protocol handlers:
- **Go Transports & Endpoints**:
  - HTTP Routers & Endpoints: `grep -E "(router\.Handle|r\.(GET|POST|PUT|DELETE)|http\.NewServeMux|mux\.Handle)"`.
  - gRPC Service Descriptors: `grep -E "(Register.*Server|grpc\.NewServer|pb\.Register)"`.
  - Database Connection Ports: `grep -E "sql\.Open\("` or database pool initializers.
  - HTTP Middleware chains: `grep -E "Use\(|WrapHandler"`.
- **Rust IPC & Protocols**:
  - Unix Domain Sockets: `grep -E "(UnixDatagram::bind|UnixListener::bind|tokio::net::UnixStream)"`.
  - gRPC Tonic Clients / Servers: `grep -E "(tonic::transport::Channel|Server::builder\(\)|add_service)"`.
  - Socket Frame Decoders: `grep -E "(FramedRead|BytesCodec|LengthDelimitedCodec)"`.

---

## 2. Smell Paths Audit (Code Anti-Patterns Checklist)
When surveying communication boundaries, check for these critical architectural anti-patterns:
- [ ] **Orphaned Request Context (Go)**: A handler creates a brand new `context.Background()` or `context.TODO()` instead of propagating `r.Context()`. When a client disconnects or times out, downstream database and gRPC queries keep running indefinitely, burning CPU and connection pools.
- [ ] **Implicit `Content-Type` Assumption**: Parsing request bodies as JSON unconditionally without validating `Content-Type: application/json`. When supplied with XML, multipart, or raw text, the unmarshaler triggers unhandled internal 500 errors instead of `415 Unsupported Media Type`.
- [ ] **Unbounded gRPC Stream Loop**: A streaming loop that fails to break upon receiving `io.EOF` or transport errors, causing infinite CPU burn or error log floods.
- [ ] **Early Return Without Resource Cleanup**: Returning errors early before `defer resp.Body.Close()` or `defer conn.Close()`, leaking sockets and connection slots.
- [ ] **Double Header Mutation / Premature Flush**: Calling `w.WriteHeader()` multiple times or writing body bytes before status code headers, triggering runtime warnings and corrupted client responses.
- [ ] **Unbounded UDS Datagram Queuing (Rust)**: Reading datagrams into memory without checking queue length or backpressure limits, leading to memory exhaustion under socket flooding.

---

## 3. Rich Candidate Catalog: Protocol Framing & Anomaly Vectors

> [!TIP]
> **SELECT STRICTLY BY ACTUAL COMMUNICATION CHANNEL:**
> Do NOT mix channel vectors. If testing an HTTP endpoint, do not test UDS buffer truncation or gRPC binary metadata. If testing gRPC, do not test HTTP header smuggling.

| ID | Protocol Channel | Hostile Anomaly / Malformed Frame | Targeted Risk / Boundary | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-A01** | **HTTP Headers** | Space before colon: `X-Custom-Header : val` | Request Smuggling, Parser Desync | HTTP Reverse proxy & Ingress handlers | Pure internal gRPC or UDS channels |
| **CAT-A02** | **HTTP Body** | Send `Content-Length: 1000`, deliver only 10 bytes | Slowloris hanging, hung worker goroutines | Any HTTP endpoint accepting request bodies | GET/HEAD requests with no body |
| **CAT-A03** | **HTTP Parameters** | Duplicate keys: `?target=1&target=2` | HTTP Parameter Pollution (HPP) | Query parameter parsers, search endpoints | Body-only or gRPC services |
| **CAT-A04** | **HTTP Chunked** | Stream aborted abruptly mid-chunk | Hanging connection, unreleased socket | Streaming upload endpoints, SSE endpoints | Buffered non-chunked endpoints |
| **CAT-A05** | **HTTP Method** | Non-standard or mixed case: `pOsT`, `CUSTOM_VERB` | Routing bypass, unhandled method panic | HTTP routers, method-based ACLs | Standard RPC function calls |
| **CAT-A06** | **HTTP TE vs CL** | Both `Transfer-Encoding: chunked` and `Content-Length` | RFC 7230 smuggling desynchronization | Edge ingress, edge proxy endpoints | Non-HTTP upstream IPC |
| **CAT-A07** | **gRPC Metadata** | Raw non-ASCII binary in ASCII metadata key | Header parser crash, transport tear-down | gRPC interceptors and service methods | HTTP/REST endpoints |
| **CAT-A08** | **gRPC Cancel** | Client cancels context immediately after request | Dangling goroutine, orphaned DB transaction | Asynchronous gRPC service handlers | Synchronous in-memory calls |
| **CAT-A09** | **Unix Socket** | Datagram packet exceeding `SO_RCVBUF` | Message truncation, corrupted JSON stream | Node agent UDS collectors, log daemons | Network HTTP/gRPC services |
| **CAT-A10** | **TCP Interruption** | Send TCP RST immediately upon receiving headers | Abrupt socket closure handling, panic in flush | High-throughput reverse proxy gateways | Unit-level service mocks |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                       CONTEXT-AWARE INTEGRATION TEST SELECTION                                │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Communication Channel    │ Mandatory Focus Vectors             │ Irrelevant / Skip Vectors     │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. Public HTTP Ingress   │ • Slowloris body delivery           │ • UDS SO_RCVBUF datagrams    │
│                          │ • TE.CL smuggling desync            │ • gRPC binary metadata        │
│                          │ • Context cancellation propagation  │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Internal gRPC Service │ • Context deadline exceeded         │ • HTTP header whitespace      │
│                          │ • Abrupt stream EOF / broken pipe   │ • Query parameter pollution  │
│                          │ • Malformed metadata serialization  │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. Node Agent UDS Socket │ • Buffer truncation on oversized pkt│ • HTTP smuggling / verbs     │
│                          │ • Socket file unlinking / reconnect │ • gRPC status codes          │
│                          │ • Backpressure drop semantics       │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 4. Database Integration  │ • Connection pool exhaustion        │ • Network protocol framing   │
│                          │ • Context timeout during query      │ • HTTP header desync         │
│                          │ • Multi-statement rollbacks         │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed API & Integration Test Matrix: [Target Service / Endpoint]
- **Target Channel**: [HTTP / gRPC / UDS / SQLite Repository]
- **Selection Rationale**: [Explain why specific protocol anomaly vectors were selected and others excluded]

| Test ID | Channel | Anomaly Vector / Hostile Input | Smell Path Targeted | Expected Behavior (Assertion) |
|---|---|---|---|---|
| TC-INT-01 | [Channel] | Standard valid payload | Happy path contract | 200/201 OK / gRPC OK, state persisted |
| TC-INT-02 | [Channel] | Client context timeout (10ms) | Context cancellation leak | Handler aborts cleanly; DB query cancelled |
| TC-INT-03 | [Channel] | [Selected Vector, e.g., CAT-A02] | Slowloris / hung reader | Server enforces read timeout; drops connection safely |
| TC-INT-04 | [Channel] | [Selected Vector, e.g., CAT-A05] | Invalid HTTP verb | Returns 405 Method Not Allowed cleanly; no 500 panic |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored integration matrix with explicit selection rationale based on the target communication channel.
> - **DO NOT** execute any network calls, spin up integration test harnesses, or write test scripts before receiving user confirmation.
> - Once approved, proceed to execution using the appropriate test suite prefixed with `rtk`.

---

## 7. Idiomatic Execution & Scripting

### Go: HTTP Integration with In-Memory `httptest`
```go
func TestTargetEndpoint_ProtocolAnomalies(t *testing.T) {
    handler := DiscoveredHandler()
    ts := httptest.NewServer(handler)
    defer ts.Close()

    t.Run("TC-INT-02: Client Context Cancellation", func(t *testing.T) {
        ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
        defer cancel()

        req, err := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/target", strings.NewReader(`{}`))
        require.NoError(t, err)

        client := &http.Client{}
        _, err = client.Do(req)
        require.Error(t, err, "Expected client request to abort on timeout")
    })

    t.Run("TC-INT-03: Unsupported Media Type Rejection", func(t *testing.T) {
        req, err := http.NewRequest(http.MethodPost, ts.URL+"/target", strings.NewReader(`<xml></xml>`))
        require.NoError(t, err)
        req.Header.Set("Content-Type", "application/xml")

        resp, err := http.DefaultClient.Do(req)
        require.NoError(t, err)
        defer resp.Body.Close()

        require.Equal(t, http.StatusUnsupportedMediaType, resp.StatusCode)
    })
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTargetEndpoint_ProtocolAnomalies
```

### Rust: Unix Domain Socket Frame Boundaries
```rust
#[tokio::test]
async fn test_tc_int_uds_oversized_datagram_truncation() {
    let socket_path = "/tmp/test_aurora_agent.sock";
    let _ = std::fs::remove_file(socket_path);

    let server = tokio::net::UnixDatagram::bind(socket_path).expect("Failed to bind UDS");
    let client = tokio::net::UnixDatagram::unbound().expect("Failed to create client UDS");

    // Send oversized datagram (65KB)
    let oversized = vec![0x41u8; 65536];
    let send_result = client.send_to(&oversized, socket_path).await;
    
    // Server must safely reject or truncate without panic
    let mut buf = vec![0u8; 4096];
    if send_result.is_ok() {
        let (len, _) = server.recv_from(&mut buf).await.expect("Failed to recv");
        assert!(len <= 4096, "Buffer must respect socket limits without crashing");
    }

    let _ = std::fs::remove_file(socket_path);
}
```
Run command via RTK:
```bash
rtk cargo test --test integration -- test_tc_int_uds_
```

---

## 8. Diagnostic Reporting Template

```markdown
### API & Integration Testing Report

- **Target Service / Port**: [Discovered Router / gRPC Service / UDS Endpoint]
- **Execution Status**: [PASS / FAIL]
- **Protocol Anomaly Results**:
  - `Context Propagation (TC-INT-02)`: Verified cancellation cleans up DB transaction within 15ms.
  - `Unsupported Media Type (TC-INT-03)`: Returns 415 cleanly; no 500 panic detected.
- **Identified Smell Paths**:
  - `Orphaned Context`: [CLEAN / WARNING: Handler found using context.Background()]
- **Remediation & Action Items**:
  - Replace `context.Background()` with `r.Context()` in handler to preserve client timeouts.
```
