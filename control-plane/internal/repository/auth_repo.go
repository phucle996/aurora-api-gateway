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
			SELECT id, username, password_hash, salt, role,
			       two_factor_enabled, two_factor_secret, two_factor_recovery_codes, two_factor_configured_at,
			       created_at, updated_at
			FROM users
			WHERE LOWER(username) = LOWER(?)
			LIMIT 1
		)
		SELECT id, username, password_hash, salt, role,
		       two_factor_enabled, two_factor_secret, two_factor_recovery_codes, two_factor_configured_at,
		       created_at, updated_at
		FROM target_user;
	`

	var u entity.User
	var twoFactorEnabledInt int

	err := r.db.QueryRowContext(ctx, query, username).Scan(
		&u.ID,
		&u.Username,
		&u.PasswordHash,
		&u.Salt,
		&u.Role,
		&twoFactorEnabledInt,
		&u.TwoFactorSecret,
		&u.TwoFactorRecoveryCodes,
		&u.TwoFactorConfiguredAt,
		&u.CreatedAt,
		&u.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, taxonomy.ErrUserNotFound
		}
		return nil, err
	}

	u.TwoFactorEnabled = twoFactorEnabledInt == 1
	return &u, nil
}

// FindByID tìm kiếm thông tin tài khoản người dùng theo ID duy nhất.
func (r *authRepository) FindByID(ctx context.Context, id string) (*entity.User, error) {
	const query = `
		WITH target_user AS (
			SELECT id, username, password_hash, salt, role,
			       two_factor_enabled, two_factor_secret, two_factor_recovery_codes, two_factor_configured_at,
			       created_at, updated_at
			FROM users
			WHERE id = ?
			LIMIT 1
		)
		SELECT id, username, password_hash, salt, role,
		       two_factor_enabled, two_factor_secret, two_factor_recovery_codes, two_factor_configured_at,
		       created_at, updated_at
		FROM target_user;
	`

	var u entity.User
	var twoFactorEnabledInt int

	err := r.db.QueryRowContext(ctx, query, id).Scan(
		&u.ID,
		&u.Username,
		&u.PasswordHash,
		&u.Salt,
		&u.Role,
		&twoFactorEnabledInt,
		&u.TwoFactorSecret,
		&u.TwoFactorRecoveryCodes,
		&u.TwoFactorConfiguredAt,
		&u.CreatedAt,
		&u.UpdatedAt,
	)

	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, taxonomy.ErrUserNotFound
		}
		return nil, err
	}

	u.TwoFactorEnabled = twoFactorEnabledInt == 1
	return &u, nil
}

// UpdateRecoveryCodes cập nhật danh sách mã dự phòng sau khi đã tiêu thụ 1 mã.
func (r *authRepository) UpdateRecoveryCodes(ctx context.Context, id string, codesJSON string) error {
	const query = `
		UPDATE users
		SET two_factor_recovery_codes = ?,
		    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?;
	`
	_, err := r.db.ExecContext(ctx, query, codesJSON, id)
	return err
}
