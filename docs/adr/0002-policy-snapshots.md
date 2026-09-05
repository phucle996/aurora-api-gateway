# ADR 0002: Rust compiler, portable snapshots

Status: Accepted for initial design. Date: 2026-09-05.

## Context

Go control plane và Rust engine dễ lệch semantics nếu có hai compiler độc lập.
Binary serialization của memory layout không phải artifact portable an toàn.

## Decision

Rust compiler CLI dùng chung rule/IR library với engine. Go gọi CLI ngoài traffic
path. Versioned snapshot chứa validated IR; load-time chuẩn bị matcher. Compile
không diễn ra trên mỗi request. Managed publish thêm authenticity verification.

## Consequences

Controller package cần compiler executable; cần timeout/resource isolation và
diagnostics contract. Load time có chi phí và phải đo. Chưa chọn binary encoding;
Stage 1 so sánh size, deterministic encoding, bounds checking và compatibility.

