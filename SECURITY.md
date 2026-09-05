# Bảo mật

Aurora WAF hiện là scaffold development, chưa có release production được hỗ trợ.
Không triển khai để bảo vệ hệ thống thật ở trạng thái này.

Chưa thiết lập địa chỉ báo cáo riêng hoặc SLA xử lý. Trước khi public repository,
maintainer cần cấu hình private vulnerability reporting và cập nhật tài liệu này.
Không đăng công khai secrets, dữ liệu request thật hay exploit chi tiết cho lỗ hổng
chưa xử lý; dùng kênh riêng đã được maintainer xác nhận.

Xem [threat model](docs/THREAT_MODEL.md) và [testing gates](docs/TESTING.md).
Thay đổi parser, FFI, authentication, policy activation cần review bảo mật trước release.

