use aurora_engine::{Engine, MAX_POLICY_BYTES};
use std::io::{self, Read, Write};

/// aurora-compile là công cụ dòng lệnh (CLI tool) độc lập dùng để thẩm định chính sách WAF.
///
/// Vai trò trong hệ thống:
/// - Control Plane gọi công cụ này trong quy trình phát hành (Publish workflow) như một cánh cổng kiểm định (Compiler Gate).
/// - Nhận dữ liệu JSON gói chính sách từ luồng đầu vào tiêu chuẩn (Stdin).
/// - Gọi chính xác hàm kiểm định `Engine::from_policy` (cùng bộ validator với module NGINX khi nạp runtime).
/// - Nếu hợp lệ: ghi lại dữ liệu ra luồng đầu ra tiêu chuẩn (Stdout) để Control Plane tạo chữ ký mã băm (Digest).
/// - Nếu không hợp lệ: kết thúc với mã lỗi để hủy bỏ đợt phát hành, ngăn chặn chính sách lỗi nạp vào NGINX.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Bước 1: Khởi tạo mảng byte động để chứa dữ liệu chính sách từ Stdin
    let mut bytes = Vec::new();

    // Bước 2: Đọc dữ liệu từ Stdin với giới hạn trần dung lượng
    // Lấy tối đa (MAX_POLICY_BYTES + 1) tức 65537 bytes:
    // Việc cộng thêm 1 byte giúp phát hiện ngay nếu client gửi payload vượt quá giới hạn 64KB cho phép
    io::stdin()
        .take(MAX_POLICY_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;

    // Bước 3: Thẩm định cấu trúc và nội dung gói chính sách qua Engine
    // Kiểm tra tính hợp lệ: schema version (1 hoặc 2), số lượng luật tối đa 1024,
    // định dạng đường dẫn chuẩn hóa (canonical path), không chứa ký tự escape hoặc xung đột.
    // Dữ liệu ở đây là JSON IR độc lập nền tảng (Portable JSON IR), không phải bộ nhớ nội bộ của Rust.
    Engine::from_policy(&bytes).map_err(|_| "invalid or unsupported policy")?;

    // Bước 4: Xuất toàn bộ dữ liệu chính sách đã kiểm định ra Stdout cho Control Plane
    io::stdout().write_all(&bytes)?;

    Ok(())
}
