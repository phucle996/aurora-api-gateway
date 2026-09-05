# Events và metrics — đề xuất

Foundation chưa export traffic events/metrics; status API chỉ phản ánh scaffold.

Event schema đích: schema_version, event_id, timestamp, node_id, request correlation
ID, host/policy ID, generation, effective action, would-be action, matched rule IDs,
score, reason, inspection duration và redacted request metadata.
Giới hạn event size, matched-rule count và sample rate ngay tại engine/adapter.

Counters đích: evaluated/allowed/blocked/logged, evaluation errors, body limit hits,
policy load failures, queue drops và applied revision status. Histogram duration cho
evaluation; không dùng client IP, raw URI, request ID làm metric labels.

NGINX worker enqueue vào buffer bounded; collector chậm không làm worker chờ.
Drop policy cần công bố (ví dụ drop newest), đếm loss và cảnh báo. Audit quản trị
publish/rollback có durability riêng; không trộn yêu cầu này với traffic log best-effort.

Health phân biệt process liveness, policy readiness và controller connectivity.
Node vẫn ready khi dùng last-known-good dù control plane mất kết nối; stale age
được báo riêng. Dashboard phải thể hiện data timestamp và unknown/unavailable,
không thay dữ liệu thiếu bằng zero gây hiểu lầm.

