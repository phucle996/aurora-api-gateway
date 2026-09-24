# Sub-skill 01: Functional Testing (Domain Logic, Boundaries & Smell Paths)

> **Core Mission**: Validate the correctness of business domain invariants, detect risky execution smell paths (e.g., swallowed errors, partial mutations), and verify resilience against boundary and malformed entry inputs without relying on brittle workflow labels or rigid assumptions.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded file paths. Locate the Subject Under Test (SUT) dynamically using code search heuristics:
- **Go Domain & Service Logic**:
  - Service interfaces & structs: `grep -E "type [A-Za-z]+Service interface"` or `grep -E "func \([a-z]+ \*[A-Za-z]+Service\)"`.
  - Repository & Port interfaces: `grep -E "type [A-Za-z]+Repository interface"`.
  - Domain validation functions: `grep -E "func \(.*\) Validate\("` or `grep -E "func Validate[A-Za-z]+\("`.
  - Core domain models: Search for structs defining business entities and state transitions.
- **Rust Domain Logic & Extensions**:
  - Extension & Trait implementations: `grep -E "impl [A-Za-z]+ for [A-Za-z]+"` or `grep -E "impl.*Extension"`.
  - Rule / Policy evaluation: `grep -E "fn evaluate\("` or `grep -E "fn process_request\("`.
  - State machine transitions: `grep -E "enum [A-Za-z]+State"` or `grep -E "match self\."`.

---

## 2. Smell Paths Audit (Code Anti-Patterns Checklist)
When reviewing the discovered implementation, audit for the following common defect paths:
- [ ] **Unchecked Type Assertion (Go)**: Using `val.(string)` or `val.(*ConcreteType)` directly instead of the two-value comma-ok idiom (`val, ok := val.(string)`). If types mismatch, this causes an instant runtime panic.
- [ ] **Shadowed Error Variable (Go)**: Declaring `res, err := ...` inside an inner block (`if`, `for`) which shadows the outer function's `err`, causing the function to mistakenly return `nil` error despite a failure.
- [ ] **Silent Fallback / Swallowed Errors**: Replacing genuine failures with silent defaults (e.g., returning default zero-values or empty configurations) rather than bubbling the error, masking severe underlying issues.
- [ ] **Blind Enum Match (Rust)**: Over-relying on wildcard match arms (`_ => ...`) that silently swallow newly added variants without compiler-enforced handling.
- [ ] **Partial Mutation Without Rollback**: Mutating in-memory or persisted state at Step 1, failing at Step 2, and leaving state half-applied or corrupted without rollback.
- [ ] **Unchecked Arithmetic / Boundary Wrap**: Direct casting like `usize as u32` in Rust or `int(floatVal)` in Go without checking bounds, resulting in numeric truncation or overflow.
- [ ] **Missing State Machine Guard**: Allowing invalid state transitions (e.g., transitioning directly from `Draft` to `Archived` without passing through required intermediate states).

---

## 3. Rich Candidate Catalog: Hostile & Boundary Inputs

> [!TIP]
> **ANTI-DOGMATISM & CONTEXT-AWARE SELECTION:**
> Do NOT blindly test every option below. Select only 2 to 4 candidates that directly match the types and invariants accepted by the target component. If a function only handles integer IDs, do not test Unicode emoji sequences.

| ID | Input Category | Candidate Hostile Input / Mutation | Targeted Risk / Boundary | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-F01** | **Empty & Whitespace String** | `""`, `"   "`, `"\t\n\r"` | Empty validation bypass, string length underflow | String fields: names, IDs, paths, tokens | Field is non-string or optional |
| **CAT-F02** | **Null Byte Injection** | `"prefix\x00suffix"`, `"\0"` | C-string termination truncation, path truncation | Strings interacting with OS, FFI, or filesystem | Pure in-memory Go/Rust strings with length tracking |
| **CAT-F03** | **Multi-byte / Complex Unicode** | `👨‍👩‍👧‍👦` (ZWJ sequence), RTL marks (`\u202E`), accents | Byte vs rune slicing panic, encoding corruption | User-provided text, search terms, header values | Fixed-format ASCII fields (e.g., UUIDs, IPv4) |
| **CAT-F04** | **Extreme Integers** | `0`, `-1`, `MaxInt32 + 1`, `MaxInt64`, `MinInt64` | Signed integer underflow, array indexing negative | Quantities, rate limits, weights, ports, counters | Non-numeric types |
| **CAT-F05** | **Special Float Values** | `NaN`, `+Inf`, `-Inf`, `-0.0`, subnormal floats | Division by zero, non-deterministic sorting | Weighted balancing, cost estimation, timeouts | Integer-only calculation |
| **CAT-F06** | **Boolean & Type Coercion** | `"true"`, `"yes"`, `"1"`, `0`, `null`, `nil` | Permissive parser type confusion, unexpected truthy | Config parsing, query parameter flags | Statically typed boolean arguments |
| **CAT-F07** | **Maximum Length Flooding** | Repeated 65,536 bytes (`"A" * 65536`) | Memory exhaustion, regex catastrophic backtracking | Unbounded string inputs, free-text metadata | Fixed-length fields with strict schema bounds |
| **CAT-F08** | **Regex Metacharacters** | `.*`, `^$`, `[a-z]+`, `\d{1,}`, `(?=...)` | Injection into dynamic regex matcher, ReDoS | Route matching patterns, filter queries | Plain literal equality comparisons |
| **CAT-F09** | **Special Characters / Paths** | `../`, `..\\`, `\r\n`, `;`, `'`, `"` | Path traversal, header injection, parser confusion | File names, paths, dynamic command builders | Strictly validated alphanumeric inputs |
| **CAT-F10** | **Temporal Boundaries** | `0` (Epoch), `2038-01-19T03:14:07Z`, Leap second | 32-bit time overflow, timezone discrepancy | Expiration timestamps, scheduled job triggers | Timeless domain logic |
| **CAT-F11** | **Duplicate & Out-of-Order Keys** | `{"k": 1, "k": 2}`, unordered map lookups | Key collision, non-deterministic iteration order | Map deserialization, permission rule sets | Primitive inputs or ordered lists |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                           CONTEXT-AWARE FUNCTIONAL TEST SELECTION                             │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Target Component Type    │ Mandatory Focus Areas               │ Irrelevant / Skip Areas       │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. Numeric Validator /   │ • Zero, negative, MaxInt/MinInt     │ • Unicode emojis             │
│    Rate Limiter          │ • Float NaN/Inf division            │ • Null byte injection        │
│                          │ • Boundary off-by-one checks        │ • Path traversal             │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Text / Path Parser    │ • Empty, whitespace, null bytes     │ • Arithmetic overflow        │
│                          │ • Traversal sequences (`../`)       │ • Float special values       │
│                          │ • Oversized strings (> 64KB)        │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. State Machine Engine  │ • Invalid state transitions         │ • Free-form text injection   │
│                          │ • Partial mutation / rollback       │ • Regex ReDoS                │
│                          │ • Idempotency on repeated trigger   │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 4. Entity Unmarshaler    │ • Duplicate keys, unexpected types  │ • Micro-second timeout drift │
│                          │ • Missing required fields           │                              │
│                          │ • Type coercion edge cases          │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

Before writing any test code, formulate a structured test proposal:

```markdown
### Proposed Functional Test Matrix: [Target Component / SUT]
- **Component Nature**: [e.g., Domain Service / State Machine / Validation Function]
- **Selection Rationale**: [Explain why specific candidate inputs were selected and others excluded]

| Test ID | Category | Targeted Input / Smell Path | Precondition | Expected Behavior (Assertion) |
|---|---|---|---|---|
| TC-FUNC-01 | Happy Path | Standard valid domain inputs | Clean initial state | Success, valid state transition, accurate output |
| TC-FUNC-02 | Smell Path | Trigger error condition on dependency | Mock dependency fails | Bubbles specific domain error; does not swallow or panic |
| TC-FUNC-03 | Hostile Input | [Selected from Catalog, e.g., CAT-F02] | SUT initialized | Safe rejection with typed error; no panic or corruption |
| TC-FUNC-04 | Boundary | [Selected from Catalog, e.g., CAT-F04] | Value at extreme limit | Correct boundary clamping or rejection |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored test scenario matrix to the user with explicit selection rationales.
> - **DO NOT** execute any test commands or write test files before receiving user confirmation.
> - Once approved, proceed to execution using the appropriate idiomatic runner prefixed with `rtk`.

---

## 7. Idiomatic Execution & Scripting

### Go: Table-Driven Test with Hostile Vectors
```go
func TestTarget_DomainLogicAndSmellPaths(t *testing.T) {
    tests := []struct {
        name        string
        input       TargetInput
        wantErr     bool
        expectedErr error
    }{
        {
            name: "TC-FUNC-03: Null byte rejection in identifier",
            input: TargetInput{
                ID:   "target\x00malformed",
                Rate: 100,
            },
            wantErr:     true,
            expectedErr: ErrInvalidIdentifier,
        },
        {
            name: "TC-FUNC-04: Negative rate boundary check",
            input: TargetInput{
                ID:   "valid-id",
                Rate: -1,
            },
            wantErr:     true,
            expectedErr: ErrOutOfRange,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            svc := NewTargetService()
            err := svc.Process(context.Background(), tt.input)
            if tt.wantErr {
                require.Error(t, err)
                if tt.expectedErr != nil {
                    require.ErrorIs(t, err, tt.expectedErr)
                }
            } else {
                require.NoError(t, err)
            }
        })
    }
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTarget_DomainLogicAndSmellPaths
```

### Rust: Property-Based Testing & Boundary Invariants
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tc_func_03_null_byte_rejected() {
        let malformed = "route\0injection";
        let result = TargetParser::validate_name(malformed);
        assert!(result.is_err(), "Null bytes must be rejected by validator");
    }

    #[test]
    fn test_tc_func_04_numeric_clamping() {
        let out_of_bounds = i64::MAX;
        let result = TargetLimiter::set_limit(out_of_bounds);
        assert!(result.is_err(), "Excessive limits must return ErrOutOfRange");
    }
}
```
Run command via RTK:
```bash
rtk cargo test --lib -- tests::test_tc_func_
```

---

## 8. Diagnostic Reporting Template

```markdown
### Functional Testing & Smell Path Audit Report

- **Target Component**: [Discovered Struct / Function / Module]
- **Execution Status**: [PASS / FAIL]
- **Smell Path Findings**:
  - `Shadowed Error (TC-FUNC-02)`: [Detected: inner scope swallowed DB error / Verified Clean: errors bubble correctly]
- **Boundary & Malformed Inputs**:
  - `CAT-F02 (Null Byte)`: Rejected with `ErrInvalidIdentifier` (Verified)
  - `CAT-F04 (Negative Int)`: Rejected with `ErrOutOfRange` (Verified)
- **Remediation & Action Items**:
  - Remove inner variable declaration at line XX to eliminate error shadowing.
```
