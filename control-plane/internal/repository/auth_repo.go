package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"database/sql"
	"errors"
)

// authRepository là nơi chịu trách nhiệm làm việc trực tiếp với cơ sở dữ liệu
// để tra cứu và lấy thông tin tài khoản người dùng từ bảng "users".
type authRepository struct {
	db *sql.DB // Biến lưu trữ kết nối tới cơ sở dữ liệu (SQLite/MySQL/PostgreSQL...)
}

// NewAuthRepository là hàm khởi tạo (Constructor).
// Khi ứng dụng khởi động, hàm này nhận vào kết nối CSDL và tạo ra đối tượng repository sẵn sàng hoạt động.
func NewAuthRepository(db *sql.DB) repo.AuthRepository {
	return &authRepository{db: db}
}

// FindByUsername tìm kiếm thông tin tài khoản của một người dùng dựa vào tên đăng nhập (username).
//
// Cách thức hoạt động:
// 1. Nhận vào tên đăng nhập (ví dụ: "admin").
// 2. Chạy câu lệnh SQL tìm trong bảng "users" xem có ai trùng tên không.
// 3. Nếu tìm thấy: Trích xuất các thông tin (ID, mật khẩu đã mã hóa, chuỗi muối, vai trò...) và gửi về cho tầng Service.
// 4. Nếu không tìm thấy: Báo lỗi "người dùng không tồn tại" (ErrUserNotFound).
func (r *authRepository) FindByUsername(ctx context.Context, username string) (*entity.User, error) {
	// Câu lệnh SQL tra cứu:
	// - "WITH target_user AS (...)": Kỹ thuật CTE, tạo một bảng tạm chứa kết quả tìm kiếm trước khi chọn ra.
	// - "LOWER(username) = LOWER(?)": Đổi cả tên trong DB và tên người dùng nhập về chữ thường.
	//    Nhờ vậy, dù người dùng gõ "Admin", "ADMIN" hay "admin" thì hệ thống vẫn tìm thấy đúng tài khoản.
	// - Dấu "?": Là vị trí truyền tham số an toàn (Parameterized Query).
	//    Cách này bắt buộc CSDL hiểu đây chỉ là chữ thuần túy, ngăn chặn hoàn toàn tin tặc chèn mã phá hoại (lỗi bảo mật SQL Injection).
	// - "LIMIT 1": Chỉ lấy đúng 1 người dùng đầu tiên tìm thấy, không quét tiếp cả bảng để tiết kiệm thời gian.
	const query = `
		WITH target_user AS (
			SELECT id, username, password_hash, salt, role, created_at, updated_at
			FROM users
			WHERE LOWER(username) = LOWER(?)
			LIMIT 1
		)
		SELECT id, username, password_hash, salt, role, created_at, updated_at
		FROM target_user;
	`

	// Biến 'u' dùng để chứa dữ liệu tài khoản sau khi đọc từ database lên
	var u entity.User

	// QueryRowContext: Gửi câu lệnh SQL tới CSDL và yêu cầu trả về đúng 1 dòng kết quả.
	// Biến 'ctx' (Context) giúp tự động hủy câu truy vấn nếu người dùng ngắt kết nối hoặc mạng bị treo quá lâu.
	// Hàm .Scan(...): Lần lượt đọc từng cột dữ liệu từ bảng và gán vào các trường tương ứng của biến 'u':
	// - ID: Mã số định danh của người dùng
	// - Username: Tên tài khoản
	// - PasswordHash: Mật khẩu đã được mã hóa an toàn (không phải mật khẩu gốc)
	// - Salt: Chuỗi muối ngẫu nhiên dùng kèm khi băm mật khẩu
	// - Role: Vai trò/quyền hạn (quản trị viên, nhân viên xem...)
	// - CreatedAt, UpdatedAt: Ngày giờ tạo và sửa tài khoản
	err := r.db.QueryRowContext(ctx, query, username).Scan(
		&u.ID,
		&u.Username,
		&u.PasswordHash,
		&u.Salt,
		&u.Role,
		&u.CreatedAt,
		&u.UpdatedAt,
	)

	// Xử lý khi có lỗi xảy ra
	if err != nil {
		// Nếu lỗi là 'sql.ErrNoRows', nghĩa là CSDL đã tìm hết bảng nhưng không thấy ai có tên đăng nhập này.
		// Ta chuyển thành lỗi chuẩn của hệ thống: taxonomy.ErrUserNotFound (Không tìm thấy tài khoản)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, taxonomy.ErrUserNotFound
		}
		// Nếu là lỗi khác (ví dụ mất kết nối mạng CSDL, ổ cứng đầy...), trả về lỗi kỹ thuật ban đầu
		return nil, err
	}

	// Đọc dữ liệu thành công! Trả về con trỏ tới thông tin người dùng và không có lỗi (nil).
	return &u, nil
}
