# Validation kiến trúc

Ngày đối chiếu nguồn: 2026-09-05. Kết luận: **khả thi về kiến trúc**; hiệu năng,
chất lượng detection và độ ổn định ABI cần chứng minh bằng prototype và benchmark.

## Các điểm đã đối chiếu

NGINX hỗ trợ build dynamic module và hook HTTP phases. Module cần tuân thủ cách
quản lý buffer, vòng đời request và đọc body bất đồng bộ. Thực thi Rust trong
worker vẫn chiếm thời gian worker; đổi ngôn ngữ không loại bỏ nguy cơ chặn event
loop. Thiết kế phải giới hạn công việc trên từng request.
[NGINX development guide](https://nginx.org/en/docs/dev/development_guide.html).

Một module `.so` không dùng được tùy ý cho mọi bản NGINX. Cần build/test theo
version, platform và cấu hình tương thích; `--with-compat` không thay thế ma trận
kiểm thử và dependency package.
[NGINX dynamic module packaging](https://blog.nginx.org/blog/creating-installable-packages-dynamic-modules).

Rust hỗ trợ C ABI nhưng boundary cần contract về ownership, layout và panic.
Panic không được unwind xuyên C frame; `catch_unwind` không khắc phục undefined
behavior, OOM abort hay mọi kiểu crash.
[Rust FFI](https://doc.rust-lang.org/nomicon/ffi.html).

React có thể phát triển thành SPA độc lập với Vite; điều này phù hợp console
không cần SSR. Routing, state server và auth được bổ sung khi có workflow thực.
[React hướng dẫn build](https://react.dev/learn/build-a-react-app-from-scratch),
[Vite guide](https://vite.dev/guide/).

## Điều chỉnh so với idea

| Ý tưởng | Quyết định ban đầu | Lý do |
| --- | --- | --- |
| Go compile tất cả rule | Go gọi compiler CLI Rust | Dùng chung semantic validation và matcher với engine |
| `rules.bin` là mã máy tối ưu | Snapshot IR versioned; matcher chuẩn bị lúc load | Tránh phụ thuộc layout bộ nhớ/regex artifact không ổn định |
| C chỉ vài dòng | C mỏng về nghiệp vụ, đủ lifecycle code | Body callback, cleanup, reload vẫn phức tạp |
| UI/API tắt thì WAF luôn OK | Worker tiếp tục với last-known-good | Cold start không có snapshot cần hành vi lỗi rõ ràng |
| Scoring tự tạo rate limit/challenge | Scoring → log/block; limiter riêng | Rate limit cần state, challenge cần protocol và UX |
| L7 firewall hiểu mọi logic app | HTTP inspection + policy đặc thù ứng dụng | Không tự hiểu authorization, business abuse hay mọi zero-day |

## Phạm vi và đánh đổi

TLS kết thúc tại NGINX trước inspection; encrypted passthrough không inspect
được nội dung HTTP. Network firewall/DDoS volumetric defense nằm ngoài sản phẩm.
Không parse lại raw HTTP framing trong Rust; dùng dữ liệu NGINX đã parse và giữ
nguyên thông tin raw/normalized cần thiết để tránh mismatch với backend.

Custom engine cho phép API rõ và adapter độc lập, nhưng phải tự đầu tư corpus,
normalization, exclusions và tuning false positive. Stage 1 cần đánh giá tái sử
dụng detector hiện có và license, không hứa tương thích ModSecurity/OWASP CRS.

## Các câu hỏi cần experiment

- C hook có xử lý chính xác body trên HTTP/1.1 và HTTP/2, internal redirect,
  subrequest, client disconnect và body trên disk không?
- Policy reload có giữ đúng generation cho request đang chạy và bounded memory?
- Chi phí latency/RSS với corpus và policy đại diện là bao nhiêu?
- Có bao nhiêu false positive trên traffic benign đại diện đã được khử dữ liệu nhạy cảm?

Các câu hỏi này là gate trong roadmap, không phải tính năng đã xác nhận.

