# Đóng góp

Đọc [README](README.md), [architecture](docs/ARCHITECTURE.md) và task đang làm trong
[roadmap](ROADMAP.md). Chỉ đánh dấu task hoàn thành khi có bằng chứng và gate tương ứng.

Thay đổi behavior cần fixtures phù hợp; FFI/lifecycle cần review ownership và error
paths. Chạy `make check` sau `make ui-install`; định dạng Rust bằng `cargo fmt --all`,
Go bằng `gofmt`. Không gọi skeleton là implementation bảo mật hoàn chỉnh.

PR mô tả vấn đề, behavior mới, cách kiểm tra và giới hạn còn lại. Quyết định kiến
trúc lớn thêm ADR; API/schema thay đổi phải cập nhật version/compatibility docs.
Không đóng góp traffic thật chứa dữ liệu cá nhân hoặc secrets.

License chưa được chọn; cần chốt trước khi mở public contribution/release.

