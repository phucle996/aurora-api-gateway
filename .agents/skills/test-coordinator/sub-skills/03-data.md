# Sub-skill 03: Data & State Integrity Testing (Fuzzing, Serialization & Invariants)

> **Core Mission**: Verify data integrity across serialization boundaries (JSON, Protobuf, Serde), test structural durability against hostile payloads (deep nesting, special floats, overflows), audit SQLite CTE query safety against NULL values, and uncover hidden edge cases via automated Fuzzing.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Locate serialization handlers, schemas, and persistence layers dynamically:
- **Go Parsers, Schemas & CTE Repositories**:
  - Deserializers: `grep -E "(json\.Unmarshal|proto\.Unmarshal|json\.NewDecoder)"`.
  - SQLite CTE Queries: `grep -E "WITH .* AS \("` or `grep -E "SELECT .* FROM.*JOIN"`.
  - Struct Scanners: `grep -E "rows\.Scan\("`.
  - Schema Validation: `grep -E 'validate:"'`.
- **Rust Serde & File Loaders**:
  - Serde Derive Structs: `grep -E "#\[derive\(.*Deserialize.*\)\]"`.
  - Serde Parsers: `grep -E "(serde_json::from_|serde_yaml::from_)"`.
  - Persistence & Spec Loaders: `grep -E "(fs::read_to_string|tokio::fs::read)"`.
  - Protobuf Code: `grep -E "(prost::Message|tonic::codec)"`.

---

## 2. Smell Paths Audit (Code Anti-Patterns Checklist)
When surveying data parsers and storage layers, check for these critical anti-patterns:
- [ ] **Unbounded Stream Ingestion (Go)**: Reading an incoming `io.Reader` using `io.ReadAll` without wrapping it in `io.LimitReader(r, maxBytes)`. An attacker sending a 500MB stream will exhaust process memory and trigger an Out of Memory (OOM) crash.
- [ ] **Unsafe CTE NULL Handling (Go/SQL)**: Performing a `LEFT JOIN` in a SQLite CTE query without `COALESCE(col, default)`, combined with scanning into non-pointer Go fields (e.g., `string` instead of `*string` or `sql.NullString`). A NULL row instantly triggers a runtime scan error.
- [ ] **Unchecked Numeric Type Casting**:
  - Go: Casting float to int (`int(val)`) when the value is `NaN` or exceeds `MaxInt64`, causing unpredictable integer wrap-around.
  - Rust: Using `as u32` or `as u16` on a `usize`, causing silent truncation on large collections.
- [ ] **Assumption of JSON Key Ordering**: Logic relying on object keys arriving in a deterministic sequence, violating the JSON RFC and causing flaky evaluation across different clients.
- [ ] **Missing Strict Field Enforcement (Rust Serde)**: Omitting `#[serde(deny_unknown_fields)]` when parsing critical security or configuration specs, allowing silently ignored misconfigurations.
- [ ] **Unprotected Disk File Deserialization**: Assuming local configuration files are always well-formed. When a file is truncated during a power loss, the daemon panics on cold boot instead of loading a fallback or returning a clean error.

---

## 3. Rich Candidate Catalog: Hostile Payloads & Data Edge Cases

> [!TIP]
> **ANTI-DOGMATISM: SELECT STRICTLY BY DATA FORMAT & STORAGE BOUNDARY:**
> If testing a SQLite repository, focus on NULL safety and CTE boundary types; do not test JSON recursive arrays. If testing a config file loader, focus on partial truncation and 0-byte files.

| ID | Data Category | Candidate Hostile Data / Mutation | Targeted Risk / Boundary | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-D01** | **Recursive JSON** | `[[[[...]]]]` (500 nested arrays) | Stack overflow via recursive parser, DoS | JSON deserializers in Go / Rust | Non-JSON formats (e.g. Proto) |
| **CAT-D02** | **Duplicate Keys** | `{"role": "user", "role": "admin"}` | Key collision, privilege escalation | Access control policies, auth claims | Arrays or primitive types |
| **CAT-D03** | **Special Float Values** | `{"rate": NaN}`, `{"weight": Infinity}` | Division by zero, non-deterministic sorting | Numeric scoring, rate limits, weights | Integer-only fields |
| **CAT-D04** | **Integer Overflow** | `{"count": 18446744073709551616}` ($2^{64}$) | Integer wrap-around, parser parse error | Large IDs, sequence numbers, counters | Bounded strings or enums |
| **CAT-D05** | **0-Byte File** | Completely empty 0-byte `.json` / `.yaml` file | Panic on EOF, unhandled empty read | Configuration loader, spec sync | In-memory payloads |
| **CAT-D06** | **Truncated File** | Half-written JSON: `{"version": 2, "rules": [` | Parser panic during cold restart | Spec files, disk caches, crash recovery | Streaming socket protocols |
| **CAT-D07** | **Non-UTF8 Bytes** | `"\xFF\xFE\xFD"` inside string field | String validation panic, UTF-8 decoder error | Free-form text fields, external headers | Binary Protobuf payloads |
| **CAT-D08** | **SQLite CTE NULL** | Rows with NULL foreign keys or missing JOINs | Scan error into non-nullable Go types | SQLite CTE repositories | Non-database domain logic |
| **CAT-D09** | **Protobuf Wire Mismatch** | Varint with 11 bytes (continuation bit set) | Wire decoder loop, unbounded buffer read | gRPC endpoints, Protobuf decoders | JSON REST APIs |
| **CAT-D10** | **Payload Stuffing** | Payload with 10,000 unrecognized fields | Memory bloat, CPU burn in reflection | Public API input validation | Private internal RPCs |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                          CONTEXT-AWARE DATA TEST SELECTION                                    │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Target Data Component    │ Mandatory Focus Vectors             │ Irrelevant / Skip Vectors     │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. SQLite CTE Repository │ • NULL scan safety (COALESCE)       │ • JSON deep recursion         │
│                          │ • Empty result set handling         │ • Protobuf wire mismatches    │
│                          │ • Foreign key cascade boundaries    │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Public JSON Ingress   │ • io.LimitReader enforcement        │ • Disk file truncation        │
│                          │ • Deeply nested arrays/objects      │ • Database NULL scans         │
│                          │ • Duplicate keys / float anomalies  │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. Disk Config Loader    │ • 0-byte file handling              │ • SQL NULL handling           │
│                          │ • Half-written truncated file       │ • HTTP header encoding        │
│                          │ • Non-UTF8 corrupted bytes          │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 4. Internal Protobuf RPC │ • Malformed varints & wire tags     │ • JSON duplicate keys         │
│                          │ • Missing required fields           │ • SQLite query plans          │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Data & State Integrity Test Matrix: [Target Component]
- **Data Boundary**: [JSON Decoder / SQLite CTE Repository / Disk Spec Loader]
- **Selection Rationale**: [Explain why specific data edge cases were chosen and others skipped]

| Test ID | Data Category | Hostile Payload / Edge Case | Smell Path Targeted | Expected Behavior (Assertion) |
|---|---|---|---|---|
| TC-DATA-01 | Happy Path | Well-formed canonical payload | Baseline serialization | Correctly deserialized, zero state corruption |
| TC-DATA-02 | Fuzzing / Hostile | [Selected from Catalog, e.g., CAT-D01] | Recursive stack overflow | Safe error return; no process crash or panic |
| TC-DATA-03 | Storage / NULL | [Selected from Catalog, e.g., CAT-D08] | SQLite NULL scan error | Cleanly mapped to default/null field; no scan panic |
| TC-DATA-04 | Disk Boundary | [Selected from Catalog, e.g., CAT-D06] | Truncated file cold boot | Graceful fallback or descriptive initialization error |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored data integrity test matrix with explicit rationale based on the data boundary.
> - **DO NOT** execute fuzzing engines, write test files, or run tests before receiving user confirmation.
> - Once approved, proceed to execution using the appropriate test suite prefixed with `rtk`.

---

## 7. Idiomatic Execution & Scripting

### Go: Native Fuzz Testing (`testing.F`)
```go
func FuzzTarget_JSONDeserialization(f *testing.F) {
    // Seed corpus with valid payloads
    f.Add([]byte(`{"version":1,"name":"default","rate":100}`))
    f.Add([]byte(`{"version":2,"name":"","rate":0}`))

    f.Fuzz(func(t *testing.T, data []byte) {
        // Enforce maximum buffer boundary
        if len(data) > 65536 {
            return
        }

        var target TargetStruct
        err := json.Unmarshal(data, &target)
        if err != nil {
            // Parser rejecting hostile payload is expected and safe
            return
        }

        // Validate domain invariants on successfully parsed structs
        require.False(t, math.IsNaN(target.Rate), "Rate must not be NaN")
    })
}
```
Run command via RTK:
```bash
rtk go test -fuzz=FuzzTarget_JSONDeserialization -fuzztime=15s ./...
```

### Rust: Property-Based Testing with `proptest`
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        #[test]
        fn test_tc_data_no_panic_on_arbitrary_string(s in "\\PC*") {
            let _ = parse_configuration(&s);
            // Invariant: Arbitrary Unicode or malformed strings must never cause panic
        }

        #[test]
        fn test_tc_data_numeric_bounds(rate in any::<f64>()) {
            if rate.is_nan() || rate.is_infinite() {
                assert!(validate_rate(rate).is_err());
            }
        }
    }
}
```
Run command via RTK:
```bash
rtk cargo test --lib -- tests::test_tc_data_
```

---

## 8. Diagnostic Reporting Template

```markdown
### Data & State Integrity Audit Report

- **Target Component**: [Discovered Parser / Repository / Spec Loader]
- **Execution Status**: [PASS / FAIL]
- **Data Edge Case Results**:
  - `Deep Nesting (TC-DATA-02)`: Safely rejected with recursion depth error (MaxDepth: 32).
  - `CTE NULL Safety (TC-DATA-03)`: Scanned 100 rows containing NULL foreign keys without errors.
- **Identified Smell Paths**:
  - `Unbounded Ingestion`: [CLEAN / WARNING: io.ReadAll found without io.LimitReader]
- **Remediation & Action Items**:
  - Wrap request body reader with `io.LimitReader(r.Body, 10<<20)` (10MB limit) at line XX.
```
