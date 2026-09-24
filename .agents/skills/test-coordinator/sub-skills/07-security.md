# Sub-skill 07: Security Testing (Smell Paths, FFI Bounds, Memory Leaks & Hostile Payloads)

> **Core Mission**: Audit authentication and authorization invariants, detect memory safety violations across unsafe FFI boundaries, prevent injection attacks (CRLF, SQL, Path Traversal), and **specifically audit security-critical memory leaks (Information Disclosure, Unauthenticated Memory Exhaustion DoS, and Sensitive Secret Zeroization)**.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Locate security checkpoints, FFI boundaries, and secret handlers dynamically:
- **Authentication & Authorization**:
  - Auth Middleware & Token Verifiers: `grep -E "(ValidateToken|jwt\.Parse|VerifySignature|Authorize)"`.
  - Permission Claims & Roles: `grep -E "(claims\.|HasRole|CheckPermission)"`.
- **FFI & Unsafe Boundaries**:
  - Rust FFI Exports: `grep -E "(extern \"C\"|#\[no_mangle\])"`.
  - Unsafe Blocks: `grep -E "unsafe \{"`.
  - Pointer Conversions: `grep -E "(std::slice::from_raw_parts|CStr::from_ptr)"`.
- **Secrets Management & Memory Lifecycle**:
  - Cryptographic Keys & Secrets: `grep -E "(private_key|SecretKey|zeroize|Zeroize)"`.
  - Pre-auth Memory Allocations: `grep -E "(make\(|Vec::with_capacity)"` in functions executed prior to token verification.
- **SQL & Query Construction**:
  - SQL Execution Calls: `grep -E "(db\.Exec|db\.Query|fmt\.Sprintf.*SELECT)"`.

---

## 2. Smell Paths Audit (Security Anti-Patterns Checklist)

### A. Security-Critical Memory Leaks & Information Disclosure
- [ ] **Out-of-Bounds Memory Read across FFI (Heartbleed-class)**: An FFI function accepts a C buffer and length, but reads beyond the specified length due to missing null-termination checks or arithmetic bugs, leaking adjacent heap memory (containing other tenants' tokens or keys) back to the client.
- [ ] **Exposure of Uninitialized Memory**: Utilizing `MaybeUninit` in Rust or uninitialized byte slices in Go without zero-filling, followed by partial population and transmission to the network, leaking previous RAM contents.
- [ ] **Missing Sensitive Secret Zeroization**: Storing private keys, decrypted secrets, or tokens in standard memory structs without implementing the `Zeroize` trait (Rust) or zero-filling bytes before deallocation (Go). When memory is freed or dumped to core dumps during panics, secrets remain readable in cleartext.

### B. Unauthenticated Memory Exhaustion (DoS)
- [ ] **Pre-Authentication Allocation DoS**: A handler allocates multi-megabyte heap buffers based on client-provided headers (`Content-Length`) before validating credentials. An unauthenticated attacker can open thousands of connections with fake large headers to force an Out of Memory (OOM) crash.
- [ ] **Heap State Leaks on Authentication Failure**: When signature verification or token parsing fails, the error branch exits early without cleaning up partially initialized cryptographic contexts, session buffers, or allocated state.

### C. Logic Vulnerabilities & Injection Deficiencies
- [ ] **Unprotected FFI Pointer Dereferencing**: Dereferencing raw pointers received across the C/Rust boundary without verifying `ptr.is_null()` or checking alignment.
- [ ] **URL Path Traversal via Unanchored Regex**: Using regex route patterns lacking start (`^`) and end (`$`) anchors, or failing to normalize URL paths before authorization checks, allowing path traversal (`/..;/admin`) bypasses.
- [ ] **JWT Algorithm Confusion (`alg: none`)**: Accepting tokens with `alg: none` or verifying HMAC signatures using public RSA keys.
- [ ] **String Concatenation in SQL**: Assembling database queries with `fmt.Sprintf` rather than parameterized placeholders (`?`).

---

## 3. Rich Candidate Catalog: Hostile Payloads & Security Memory Vectors

> [!TIP]
> **ANTI-DOGMATISM: SELECT VECTORS MATCHING THE ATTACK SURFACE:**
> If testing an internal FFI library, focus on buffer boundaries and pointer nullability; do not test HTTP header CRLF. If testing a public router, focus on path traversal, auth DoS, and token tampering.

| ID | Attack Vector Category | Hostile Payload / Fault Vector | Targeted Security Risk | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-S01** | **Out-of-Bounds FFI Read** | C buffer passed with length declared > allocated | Heap memory disclosure (Info Leak) | C $\leftrightarrow$ Rust FFI boundaries | Pure Go or Rust code without FFI |
| **CAT-S02** | **Unauthenticated Memory DoS**| Send 50MB payload with invalid token | Heap allocation before auth $\rightarrow$ OOM | Public endpoints requiring auth | Endpoints without payload bodies |
| **CAT-S03** | **Auth Failure Memory Leak** | 100,000 invalid signatures in a loop | Heap memory leak on error return path | Cryptographic verification modules | Unauthenticated endpoints |
| **CAT-S04** | **Secret Zeroization Audit** | Inspect heap dump after secret drop | Plaintext key persistence in RAM | Key management, TLS cert loaders | Components handling non-sensitive data |
| **CAT-S05** | **Path Traversal (Unicode/Encoding)**| `%c0%af..%c0%afadmin/v1`, `/..;/api` | Path normalization bypass, auth bypass | HTTP Routers, URL dispatchers | Non-routing internal handlers |
| **CAT-S06** | **Null Byte Path Truncation** | `/api/v1/public\x00/admin` | C-string cut-off, file bypass | Filesystem access, FFI path params | Memory-only routers |
| **CAT-S07** | **CRLF Header Injection** | `val\r\nSet-Cookie: session=evil` | Response splitting, cookie fixation | Header mutation, reverse proxy upstream | Internal binary protocols |
| **CAT-S08** | **JWT Algorithm None / Confusion**| `{"alg":"none"}` or HMAC with RSA pubkey | Complete authentication bypass | Token verification middleware | Static API key authenticators |
| **CAT-S09** | **SQL Injection via Raw Params** | `' OR 1=1 --`, `1; DROP TABLE` | Unauthorized data access/destruction | Database repositories with raw queries | Strict CTE repositories with params |
| **CAT-S10** | **Timing Attack on Signatures** | Varying byte matches in HMAC comparison | Side-channel private key recovery | Signature / MAC verification | Token validation via standard libraries |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                          CONTEXT-AWARE SECURITY TEST SELECTION                                │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Target Security Surface  │ Mandatory Focus Vectors             │ Irrelevant / Skip Vectors     │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. C/Rust FFI Boundary   │ • Out-of-bounds buffer reads        │ • SQL injection               │
│                          │ • NULL pointer dereference guards   │ • JWT algorithm none          │
│                          │ • Memory freeing ownership rules    │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Public Auth Middleware│ • Pre-auth memory allocation DoS    │ • FFI buffer over-read        │
│                          │ • Auth failure memory leak loop     │ • SQLite file permissions     │
│                          │ • JWT algorithm confusion           │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. HTTP Request Router   │ • URL normalization & traversal     │ • Secret zeroization in RAM   │
│                          │ • CRLF header injection             │ • Cryptographic timing leaks  │
│                          │ • Null byte string truncation       │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 4. Secret / Key Manager  │ • Zeroization on drop / dealloc     │ • HTTP response splitting     │
│                          │ • Core dump memory protection       │ • URL path traversal          │
│                          │ • Constant-time comparison          │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Security Test Plan: [Target Security Surface / Component]
- **Target Surface**: [FFI Boundary / Auth Middleware / HTTP Router / Key Store]
- **Selection Rationale**: [Explain why specific attack vectors and memory leak checks were selected]

| Test ID | Security Category | Attack Vector / Hostile Payload | Targeted Vulnerability | Expected Behavior (Assertion) |
|---|---|---|---|---|
| TC-SEC-01 | Auth Enforcement | Valid Token vs Expired Token | Access control boundary | 200 OK for valid, 401 Unauthorized for expired |
| TC-SEC-02 | Memory Leak Audit | [CAT-S03] 50,000 invalid signatures | Auth failure heap leak | Zero net memory growth after garbage collection |
| TC-SEC-03 | Input Sanitization | [CAT-S05] Encoded traversal (`%c0%af`) | Router auth bypass | Safely normalized or rejected with 400/404 |
| TC-SEC-04 | FFI Memory Safety | [CAT-S01] Buffer read boundary test | Heartbleed info leak | Returns error or truncates to valid length |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored security testing plan with exact attack vectors, payloads, and memory leak checks.
> - **DO NOT** execute security scanners, attack scripts, or write test files before receiving user confirmation.
> - Once approved, proceed to execution via `rtk`.

---

## 7. Idiomatic Execution & Scripting

Save all generated security scripts in `scripts/test/security/`.

### Go: Auth Failure Memory Leak Verification
```go
func TestTarget_AuthFailureMemoryLeak(t *testing.T) {
    handler := DiscoveredAuthMiddleware()
    server := httptest.NewServer(handler)
    defer server.Close()

    // Force GC to establish baseline memory
    runtime.GC()
    var memBefore runtime.MemStats
    runtime.ReadMemStats(&memBefore)

    // Send 10,000 requests with invalid auth tokens
    client := server.Client()
    for i := 0; i < 10000; i++ {
        req, err := http.NewRequest(http.MethodGet, server.URL+"/protected", nil)
        require.NoError(t, err)
        req.Header.Set("Authorization", "Bearer invalid-signature-token-payload")

        resp, err := client.Do(req)
        require.NoError(t, err)
        resp.Body.Close()
        require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
    }

    // Force GC and measure residual memory
    runtime.GC()
    var memAfter runtime.MemStats
    runtime.ReadMemStats(&memAfter)

    // Allowed growth should be negligible (< 2MB for 10k failed requests)
    growthBytes := int64(memAfter.HeapAlloc) - int64(memBefore.HeapAlloc)
    require.Less(t, growthBytes, int64(2<<20), "Memory grew by %d bytes during auth failure loop; possible heap leak", growthBytes)
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTarget_AuthFailureMemoryLeak
```

### Rust: Secret Zeroization Verification
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use zeroize::Zeroize;

    #[test]
    fn test_tc_sec_secret_zeroization() {
        let mut key_buffer = vec![0x42u8; 32];
        let secret = TargetSecret::new(&key_buffer);
        
        // Ensure secret wraps and owns the buffer
        assert_eq!(secret.expose(), &[0x42u8; 32]);

        // Explicitly drop and zeroize
        drop(secret);
        key_buffer.zeroize();

        // Verify buffer is cleared
        assert!(key_buffer.iter().all(|&b| b == 0), "Secret buffer must be zeroized in RAM");
    }
}
```
Run command via RTK:
```bash
rtk cargo test --lib -- tests::test_tc_sec_
```

---

## 8. Diagnostic Reporting Template

```markdown
### Security & Memory Leak Audit Report

- **Target Component**: [Discovered Middleware / FFI Layer / Router]
- **Execution Status**: [PASS / VULNERABILITY DETECTED]

#### Security Findings & Test Outcomes:
- `Auth Failure Memory Leak (TC-SEC-02)`: 10,000 invalid attempts resulted in 0.12 MB heap delta $\rightarrow$ [PASS - No Memory Leak].
- `Pre-Auth Allocation DoS`: [CLEAN: Server rejects headers exceeding 1MB prior to body buffer allocation].
- `Path Traversal (TC-SEC-03)`: Encoded `%c0%af..%c0%af` rejected with HTTP 400 $\rightarrow$ [PASS].
- `Secret Zeroization (TC-SEC-04)`: Memory zeroed on drop; no residual keys found in memory scan.

#### Remediation & Action Items:
- None required; security invariants strictly upheld.
```
