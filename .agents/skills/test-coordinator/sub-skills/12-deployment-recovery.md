# Sub-skill 12: Deployment, Recovery & Durability Testing (Cold Boot & Atomic Swaps)

> **Core Mission**: Validate state durability across crashes, verify atomic file swap guarantees, audit cold boot recovery from corrupted or incomplete configurations, and ensure graceful shutdown with zero in-flight connection loss without relying on brittle workflow names.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Dynamically locate file persistence, signal handlers, and recovery routines:
- **Persistence & File Swapping**:
  - File Write & Sync Operations: `grep -E "(os\.WriteFile|os\.Rename|Sync\(\)|std::fs::write|std::fs::rename)"`.
  - Atomic File Temp Patterns: `grep -E "(\.tmp|tempfile|NamedTempFile)"`.
- **Signal Handling & Shutdown Lifecycle**:
  - Graceful Shutdown Listeners: `grep -E "(signal\.Notify|SIGTERM|SIGINT|tokio::signal)"`.
  - Server Shutdown Deadlines: `grep -E "(server\.Shutdown|GracefulShutdown)"`.
- **Spec Recovery & Backup Systems**:
  - Backup & Fallback Mechanisms: `grep -E "(backup|fallback|restore|revert|load_cached_spec)"`.
  - Cold Boot Initializers: `grep -E "(func Initialize|fn init|boot)"`.

---

## 2. Smell Paths Audit (Durability Anti-Patterns Checklist)
When surveying file persistence and shutdown lifecycle code, audit for these critical failure paths:
- [ ] **Direct File Truncation Without Atomic Rename**: Overwriting an active configuration file directly (`os.OpenFile(..., O_TRUNC)`) instead of writing to an adjacent temporary file (`spec.json.tmp`), executing `file.Sync()`, and performing an atomic rename (`os.Rename`). A power cut or process crash during the write leaves a permanently corrupted 0-byte configuration file on disk.
- [ ] **Missing `fsync` (`file.Sync()`) Before Rename**: Executing an atomic rename without first flushing OS write buffers to disk via `fsync()`. During a sudden hardware power loss, metadata is updated while data blocks remain unflushed, resulting in zeroed files.
- [ ] **Silent Failure on Disk Full (`ENOSPC`)**: Catching file write errors without surfacing them, allowing the gateway to run with obsolete memory state while believing it has persisted changes.
- [ ] **Infinite Graceful Shutdown Hang**: Waiting indefinitely for long-running connections or hung background tasks to complete during `SIGTERM`, preventing container orchestrators (e.g., Kubernetes) from terminating cleanly before issuing a hard `SIGKILL`.
- [ ] **Fatal Crash-Loop on Corrupted Spec File**: Failing to start up when the local cached spec is partially corrupted, rather than falling back to an earlier valid snapshot or querying the control plane for a fresh copy.
- [ ] **Unhandled Read-Only Filesystem (`EROFS`)**: Crashing the entire read-only data plane when failing to write ephemeral runtime metrics or cache files to disk.

---

## 3. Rich Candidate Catalog: Durability Failures & Crash Scenarios

> [!TIP]
> **ANTI-DOGMATISM: SELECT DISK & LIFECYCLE FAULTS MATCHING COMPONENT ROLE:**
> If testing an in-memory cache, do not test atomic file swaps or disk fsync. If testing a stateless proxy, focus on graceful shutdown and signal handling.

| ID | Failure Category | Injected Fault / Hostile Lifecycle | Targeted Durability Invariant | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-M01** | **Interrupted File Write** | SIGKILL process while writing spec file | Active file remains uncorrupted (Atomic Rename) | Local spec synchronizers, config persisters | Pure in-memory services |
| **CAT-M02** | **Cold Boot Corrupt Spec** | Corrupt JSON file: `{"version": 2, "broken` | Gateway reverts to backup spec or fetches fresh | Local spec loader, agent cold restart | Stateless microservices |
| **CAT-M03** | **Disk Full (`ENOSPC`)** | Mount 1MB loop device, fill completely | Safe error return; no half-written garbage files | Disk loggers, local cache writers | Memory-only caches |
| **CAT-M04** | **Read-Only Filesystem** | Write to directory with permissions `0444` | Graceful degradation; server continues running | Edge data plane in container environments | Control plane DB writers |
| **CAT-M05** | **0-Byte Spec File Recovery**| Provide 0-byte configuration file at boot | Clean error detection without runtime panic | Bootstrap config loaders | Runtime request handlers |
| **CAT-M06** | **Graceful Shutdown Drain** | Send SIGTERM while 200 requests are active | All 200 finish cleanly; new conns rejected | HTTP / gRPC Ingress proxies | Short-lived CLI commands |
| **CAT-M07** | **Shutdown Timeout Clamp** | Worker hangs during shutdown; verify deadline | Hard shutdown triggers after configured timeout | Process lifecycle managers | Single-threaded scripts |
| **CAT-M08** | **SQLite Sudden SIGKILL** | SIGKILL process mid-transaction | SQLite WAL recovery cleans up cleanly on reboot | SQLite persistence engines | Network-only services |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                      CONTEXT-AWARE DURABILITY TEST SELECTION                                  │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Component Lifecycle Role │ Mandatory Focus Scenarios           │ Irrelevant / Skip Scenarios   │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. Local Spec Synchronizer│ • Interrupted file write (Atomic)   │ • Graceful connection drain  │
│                          │ • Cold boot corrupt spec recovery   │ • Network packet drops       │
│                          │ • ENOSPC disk full write safety     │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. Public Ingress Proxy  │ • Graceful shutdown connection drain│ • Atomic file rename         │
│                          │ • Shutdown timeout clamp            │ • SQLite WAL recovery        │
│                          │ • Fast signal response (SIGTERM)    │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. SQLite Storage Engine │ • Process SIGKILL mid-transaction   │ • HTTP connection draining   │
│                          │ • WAL auto-checkpoint on restart    │ • Read-only filesystem logs  │
│                          │ • Corrupt database file detection   │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Deployment, Recovery & Durability Test Plan: [Target Component]
- **Target Lifecycle Role**: [Spec Synchronizer / Ingress Proxy / SQLite Storage Engine]
- **Selection Rationale**: [Explain why specific recovery and durability scenarios were chosen]

| Test ID | Scenario Category | Fault Injection / Lifecycle Event | Expected Invariant (Assertion) |
|---|---|---|---|
| TC-REC-01 | Atomic Persistence | [CAT-M01] Simulate crash during write | Existing configuration file remains intact and valid |
| TC-REC-02 | Cold Boot Recovery | [CAT-M02] Corrupted config file on disk | Reverts to backup spec or logs clean diagnostic error |
| TC-REC-03 | Graceful Drain | [CAT-M06] SIGTERM with active requests | Completes existing requests (200 OK); exits within 5s |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored durability and recovery test plan with exact fault injections and invariants.
> - **DO NOT** execute crash scripts, process signals, or write test files before receiving user confirmation.
> - Once approved, proceed to execution via `rtk`.

---

## 7. Idiomatic Execution & Scripting

### Go: Atomic File Swap Verification
```go
func TestTarget_AtomicFilePersistence(t *testing.T) {
    tempDir := t.TempDir()
    specPath := filepath.Join(tempDir, "active_spec.json")

    // Write initial valid spec
    initialData := []byte(`{"version":1,"routes":["/v1"]}`)
    err := os.WriteFile(specPath, initialData, 0644)
    require.NoError(t, err)

    // Execute atomic update helper
    newData := []byte(`{"version":2,"routes":["/v1","/v2"]}`)
    err = AtomicWriteFile(specPath, newData, 0644)
    require.NoError(t, err)

    // Verify written data
    readData, err := os.ReadFile(specPath)
    require.NoError(t, err)
    require.Equal(t, newData, readData)

    // Verify temporary files are cleaned up
    entries, err := os.ReadDir(tempDir)
    require.NoError(t, err)
    require.Len(t, entries, 1, "Temporary files were left in the directory after atomic write")
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTarget_AtomicFilePersistence
```

### Rust: Atomic Tempfile Swap with `tempfile`
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_tc_rec_01_atomic_write_fsync() {
        let dir = tempfile::tempdir().unwrap();
        let target_file = dir.path().join("active_spec.json");

        std::fs::write(&target_file, b"{\"version\":1}").unwrap();

        // Perform atomic update using named tempfile
        let mut temp = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        temp.write_all(b"{\"version\":2}").unwrap();
        temp.as_file().sync_all().unwrap(); // Ensure fsync before rename
        temp.persist(&target_file).unwrap();

        let content = std::fs::read_to_string(&target_file).unwrap();
        assert_eq!(content, "{\"version\":2}");
    }
}
```
Run command via RTK:
```bash
rtk cargo test --lib -- tests::test_tc_rec_
```

---

## 8. Diagnostic Reporting Template

```markdown
### Deployment, Recovery & Durability Audit Report

- **Target Component**: [Discovered Spec Synchronizer / Ingress Server / DB Engine]
- **Execution Status**: [PASS / DURABILITY FAILURE DETECTED]
- **Lifecycle & Durability Outcomes**:
  - `Atomic File Swap (TC-REC-01)`: Tempfile + fsync + rename pattern verified $\rightarrow$ [PASS].
  - `Corrupt Spec Cold Boot (TC-REC-02)`: Invalid JSON safely rejected with descriptive error; no panic $\rightarrow$ [PASS].
  - `Graceful Shutdown Drain (TC-REC-03)`: Active requests completed successfully within 1.2s post-SIGTERM $\rightarrow$ [PASS].
- **Identified Anti-Patterns**:
  - `Direct Truncation`: [CLEAN: No direct O_TRUNC writes detected without tempfile].
- **Remediations**: None required.
```
