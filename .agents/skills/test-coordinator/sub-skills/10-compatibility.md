# Sub-skill 10: Compatibility & Schema Migration Testing (Contracts, Schemas & ABI)

> **Core Mission**: Enforce backward and forward compatibility across evolution boundaries, verify database migration reversibility (Up/Down cycles), validate Protobuf API contracts against wire breaks, and verify memory layout stability in C FFI interfaces without relying on brittle workflow names.

---

## 1. Dynamic Discovery Heuristics
Never depend on hardcoded paths. Dynamically locate schema definitions, migrations, and ABI headers:
- **Protobuf Contracts**:
  - Proto Schemas: Search for `syntax = "proto3";` in `*.proto`.
  - Buf Configs: `find_by_name` for `buf.yaml` or `buf.gen.yaml`.
- **Database Migrations**:
  - Migration Files: Search for `*.sql` in directories matching `migration*` or `schema*`.
  - Migration Runners: `grep -E "(goose|migrate|golang-migrate|refinery)"`.
- **C FFI & Binary ABI Boundaries**:
  - Rust C Layouts: `grep -E "#\[repr\(C\)\]"`.
  - C Header Files: Search for `*.h` in FFI or adapter directories.
  - Exported Symbols: `grep -E "#\[no_mangle\]"`.

---

## 2. Smell Paths Audit (Compatibility Anti-Patterns Checklist)
When reviewing evolving schemas and interfaces, audit for these compatibility traps:
- [ ] **Protobuf Tag Reuse / Renumbering**: Changing an existing field's numeric tag (e.g., changing `string id = 1` to `string id = 2`) or deleting a field without adding `reserved X;`. When old clients communicate with updated servers, fields deserialize into incorrect properties.
- [ ] **Wire-Incompatible Field Type Mutations**: Changing a Protobuf field from `string` to `bytes` or `int32` to `int64` without following strict Protobuf wire-format compatibility rules.
- [ ] **Irreversible Database Migrations**: Providing an `Up` SQL migration that drops tables/columns or alters types without a tested and fully functioning `Down` rollback script.
- [ ] **Breaking Column Addition Without Defaults**: Adding a `NOT NULL` column to a SQLite table without a `DEFAULT` clause, causing existing code or in-flight writes to immediately fail during rolling upgrades.
- [ ] **Rust `#[repr(C)]` Struct Field Reordering**: Reordering fields or modifying types in a Rust struct marked `#[repr(C)]` without matching the layout in C headers, causing memory corruption and segmentation faults across the FFI boundary.
- [ ] **Enum Variant Value Shift**: Inserting a new enum variant in the middle of a list rather than appending at the end, shifting integer ordinals for all subsequent variants.

---

## 3. Rich Candidate Catalog: Compatibility Violations & ABI Hazards

> [!TIP]
> **ANTI-DOGMATISM: TARGET THE EXACT EVOLUTION BOUNDARY:**
> Do NOT run `buf breaking` on SQLite migrations. Do NOT test C ABI alignment on pure Go REST handlers.

| ID | Boundary Category | Breaking Mutation / Hazard | Targeted Risk / Invariant | When to Apply (Applicability) | Skip When (Anti-Dogmatism) |
|---|---|---|---|---|---|
| **CAT-K01** | **Proto Tag Renumbering** | Change field tag from 2 to 5 | Wire deserialization corruption | Protobuf definitions & gRPC APIs | Non-Proto REST APIs |
| **CAT-K02** | **Proto Tag Deletion** | Delete field without `reserved` | Tag reused in future, breaking old clients | Protobuf evolution | Static schemas |
| **CAT-K03** | **Proto Type Incompatibility** | Change `int32` to `string` | Unmarshal failure across versions | Protobuf field updates | Non-Proto schemas |
| **CAT-K04** | **DB Migration Up/Down Cycle** | Apply Up $\rightarrow$ Down $\rightarrow$ Up | Irreversible migration, corrupted rollback | SQLite database migrations | Stateless services |
| **CAT-K05** | **Non-Null Column Without Default** | `ALTER TABLE t ADD COLUMN c NOT NULL` | Instant write failure on old nodes | SQLite table schema evolutions | In-memory tables |
| **CAT-K06** | **C ABI Struct Layout Drift** | Add field in Rust `#[repr(C)]` without C header update | Memory alignment mismatch, buffer corruption | C $\leftrightarrow$ Rust FFI data exchange | Pure Go or pure Rust code |
| **CAT-K07** | **Enum Ordinal Shift** | Insert variant at index 1 of enum | Mismatched numeric state interpretation | State machines, serialized enums | String-based enums |
| **CAT-K08** | **Foreign Key Migration Lockout**| Migration modifies parent table with cascade | SQLite foreign key constraint violation | SQLite schema with foreign keys | Independent flat tables |

---

## 4. Context-Aware Selection Framework

```text
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│                       CONTEXT-AWARE COMPATIBILITY TEST SELECTION                              │
├──────────────────────────┬─────────────────────────────────────┬──────────────────────────────┤
│ Evolution Boundary       │ Mandatory Focus Vectors             │ Irrelevant / Skip Vectors     │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 1. gRPC / Protobuf API   │ • Tag renumbering & reservation     │ • SQLite migration rollback  │
│                          │ • Wire type compatibility           │ • C ABI struct padding       │
│                          │ • buf breaking check against main   │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 2. SQLite Database       │ • Full Up -> Down -> Up cycle       │ • Protobuf wire tags         │
│                          │ • Default values for new columns    │ • C ABI alignment            │
│                          │ • Foreign key integrity across run  │                              │
├──────────────────────────┼─────────────────────────────────────┼──────────────────────────────┤
│ 3. C/Rust FFI Interface  │ • Struct memory alignment / padding │ • SQL migrations             │
│                          │ • Symbol export name consistency    │ • Protobuf schema rules      │
│                          │ • Pointer sized type stability      │                              │
└──────────────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

---

## 5. Tailored Scenario Proposal Template

```markdown
### Proposed Compatibility & Migration Test Plan: [Target Boundary]
- **Boundary Type**: [Protobuf Contract / SQLite Migration / C ABI]
- **Verification Tools**: [buf breaking / goose / ABI diff / cargo check]
- **Selection Rationale**: [Explain why specific compatibility checks were selected and others skipped]

| Test ID | Boundary Category | Verification Operation | Pass Invariant (Assertion) |
|---|---|---|---|
| TC-COMP-01 | Contract Breaking | `buf breaking --against '.git#branch=main'` | Zero breaking wire changes detected |
| TC-COMP-02 | DB Reversibility | Run migration Up, then Down, then Up | Schema identical; zero migration errors |
| TC-COMP-03 | Rolling Upgrade | Insert record via old schema, read via new | Forward and backward data compatibility preserved |
```

---

## 6. User Approval Protocol (STOP & WAIT)

> [!IMPORTANT]
> **HUMAN APPROVAL GATE - MANDATORY STOPPING POINT**
> - Present the tailored compatibility test proposal with target branches, migration files, and ABI checks.
> - **DO NOT** execute schema migrations, breaking linters, or write test files before receiving user confirmation.
> - Once approved, proceed to execution via `rtk`.

---

## 7. Idiomatic Execution & Scripting

### Protobuf Wire Compatibility Verification via `buf`
Run command via RTK:
```bash
rtk buf breaking --against ".git#branch=main"
```

### Go: SQLite Migration Up/Down Reversibility Test
```go
func TestTarget_MigrationReversibility(t *testing.T) {
    dbPath := filepath.Join(t.TempDir(), "test_migration.db")
    db, err := sql.Open("sqlite3", dbPath)
    require.NoError(t, err)
    defer db.Close()

    migrationDir := DiscoveredMigrationDir()

    // 1. Run Migration Up
    err = runMigrationsUp(db, migrationDir)
    require.NoError(t, err, "Migration UP failed")

    // Insert canary row
    _, err = db.Exec("INSERT INTO target_table (id, created_at) VALUES ('canary', 1000)")
    require.NoError(t, err)

    // 2. Run Migration Down
    err = runMigrationsDown(db, migrationDir)
    require.NoError(t, err, "Migration DOWN failed (Migration is not reversible!)")

    // 3. Run Migration Up again
    err = runMigrationsUp(db, migrationDir)
    require.NoError(t, err, "Re-running Migration UP after rollback failed")
}
```
Run command via RTK:
```bash
rtk go test -v ./... -run TestTarget_MigrationReversibility
```

---

## 8. Diagnostic Reporting Template

```markdown
### Compatibility & Schema Migration Audit Report

- **Target Boundary**: [Discovered Proto Directory / SQLite Migration Path / FFI Header]
- **Execution Status**: [PASS / BREAKING CHANGE DETECTED]
- **Compatibility Verification Outcomes**:
  - `Protobuf Wire Breaking Check`: buf verified zero tag collisions or wire-type shifts $\rightarrow$ [PASS].
  - `Database Migration Reversibility`: Up $\rightarrow$ Down $\rightarrow$ Up executed successfully against clean SQLite instance $\rightarrow$ [PASS].
- **Identified Anti-Patterns**:
  - `Field Reservation`: Field tag 4 marked as `reserved 4;` $\rightarrow$ [VERIFIED SAFE].
- **Remediations**: None required.
```
