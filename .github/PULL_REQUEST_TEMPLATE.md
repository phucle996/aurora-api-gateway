## Summary

Briefly explain the purpose of this PR and what problem it solves.

## Changes Proposed

- [ ] Describe specific code changes made.
- [ ] Component(s) affected: `engine` (Rust), `ffi` (C ABI), `adapters` (NGINX), `control-plane` (Go), or `ui` (React).

## Invariants & Design Principles

- [ ] Preserves workflow isolation and minimal blast radius.
- [ ] Follows zero-allocation principles on the data-plane hot path (if applicable).
- [ ] Uses CTE-first query design for control-plane repositories (if applicable).
- [ ] Does not introduce generic/unbounded helper abstractions without proven multi-workflow demand.

## Testing & Verification

Describe the tests executed to verify this change:
- [ ] Unit tests added/updated (`go test ./...`, `cargo test`).
- [ ] Static analysis passed (`make check`, `cargo clippy`, `gofmt`).
- [ ] Integration tests or Docker cluster verification (`docker compose up`).

## Related Issues

Fixes #(issue number)
