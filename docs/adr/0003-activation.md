# ADR 0003: Graceful reload và last-known-good

Status: Accepted for MVP design. Date: 2026-09-05.

## Context

Hot swap trong nhiều worker làm ownership/generation và recovery phức tạp trước
khi có adapter được kiểm chứng.

## Decision

MVP stage artifact, validate config rồi graceful reload NGINX. Giữ last-known-good,
old workers drain generation cũ. Invalid update không thay active state. Enable
WAF nhưng cold start không có valid snapshot phải fail config/start.

## Consequences

Rollout có thời gian nhiều generation cùng chạy, cần quan sát applied revision.
Không cam kết simultaneous activation toàn worker/fleet. Reload privilege phải
giới hạn; agent không được shell execute tùy ý từ dữ liệu API. Xem lại hot swap sau
khi có benchmark và lifecycle stress tests.

