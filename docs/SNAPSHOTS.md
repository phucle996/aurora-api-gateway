# Snapshot và distribution — đề xuất

Local exact-path publish/activation đã có: [RULES_BACKEND.md](RULES_BACKEND.md).
Full IR, signing/fleet và applied ACK dưới đây vẫn là thiết kế đích.

Runtime bootstrap hiện load bounded JSON policy khi parse NGINX config. Compiled IR
và distribution trong tài liệu này vẫn là thiết kế tương lai; xem [runtime](RUNTIME.md).

`rules.bin` là tên artifact dự kiến, chưa có binary format implementation.
Không serialize thẳng Rust struct hoặc pointer. Envelope cần magic, format/schema
version, engine compatibility, policy ID/revision, payload length và content digest.
Payload là portable IR; engine validate và dựng matcher khi load. Signing dành cho
managed distribution; checksum chỉ phát hiện corruption, không xác thực publisher.

## Publish transaction

1. API nhận draft revision có optimistic concurrency.
2. Go gọi Rust compiler CLI với input/output file giới hạn, timeout và diagnostics.
3. Lưu artifact immutable cùng digest, version và audit record.
4. Agent authenticate, tải artifact vào staging trên cùng filesystem với active.
5. Verify publisher, digest, compatibility, size và engine validation.
6. Fsync artifact, atomic rename theo filesystem contract, kiểm tra NGINX config,
   graceful reload; lưu last-known-good và generation acknowledgement.
7. Controller chỉ báo applied khi có xác nhận từ node; desired != applied khi rollout lỗi.

Rename file không tự làm worker cập nhật bộ nhớ. Reload/activation là bước riêng.
Multi-node rollout dùng canary, timeout, pause/rollback; không gọi toàn fleet atomic.

## Recovery

Rollback đến artifact từng được xác thực với audit và revision mới cho thao tác
rollback. Chống replay không được ngăn rollback hợp lệ; cơ chế authorize rollback
cần tách khỏi monotonic desired revision. Giữ ít nhất active + previous theo quota.
Crash giữa các bước phải recover từ journal/manifest và báo trạng thái nhất quán.
Không ghi đè active snapshot đang được tham chiếu bằng nội dung chưa validate.
