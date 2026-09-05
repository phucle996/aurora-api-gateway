# ADR 0001: React / Go / Rust / C

Status: Accepted for initial design. Date: 2026-09-05.

## Context

Cần NGINX add-on xử lý traffic cục bộ và console optional; engine có thể tái sử
dụng ở adapter khác trong tương lai.

## Decision

Rust core không phụ thuộc NGINX. C adapter quản lý lifecycle và FFI. Go quản lý
API/agent/orchestration. React là static SPA ngoài request path. Management API
không cung cấp decision RPC đồng bộ cho request.

## Consequences

Cần quản lý nhiều toolchain và FFI safety. Tắt UI/controller không làm mất policy
đang active. Envoy/standalone là extension tương lai, không làm cùng MVP.
Xem lại nếu prototype cho thấy complexity FFI không đạt reliability gate.

