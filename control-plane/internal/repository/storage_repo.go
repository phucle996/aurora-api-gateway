package repository

import (
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"database/sql"
)

// storageRepository chịu trách nhiệm kiểm tra tình trạng hoạt động (Health check / Readiness probe)
// của tầng lưu trữ cơ sở dữ liệu để đảm bảo hệ thống đã sẵn sàng phục vụ các yêu cầu.
type storageRepository struct {
	db *sql.DB // Kết nối tới cơ sở dữ liệu
}

// NewStorageRepository khởi tạo đối tượng storageRepository nhận vào kết nối CSDL.
func NewStorageRepository(db *sql.DB) repo.StorageRepository {
	return &storageRepository{db: db}
}

// Check thực hiện kiểm tra kết nối CSDL và xác nhận rằng hệ thống đã hoàn tất di trú schema ban đầu (version = 1).
//
// Quy trình kiểm tra:
// 1. Chạy câu truy vấn CTE tra cứu bản ghi version 1 trong bảng schema_migrations.
// 2. Nếu CSDL đang hoạt động tốt và bảng tồn tại, câu lệnh sẽ trả về giá trị 1 thành công (nil error).
// 3. Nếu CSDL bị treo, mất kết nối, đóng đột ngột hoặc chưa khởi tạo schema, hàm sẽ trả về lỗi tương ứng.
func (r *storageRepository) Check(ctx context.Context) error {
	// Câu truy vấn CTE kiểm tra trạng thái schema:
	// - WITH target_migration AS (...): Bảng tạm lấy bản ghi migration đầu tiên (version = 1).
	// - LIMIT 1: Chỉ lấy đúng 1 bản ghi để tối ưu thời gian phản hồi cho các lượt probe định kỳ.
	const query = `
		WITH target_migration AS (
			SELECT version 
			FROM schema_migrations 
			WHERE version = 1 
			LIMIT 1
		)
		SELECT version 
		FROM target_migration;
	`

	var version int
	// Gửi câu truy vấn kiểm tra tới CSDL và bóc tách kết quả vào biến 'version'
	return r.db.QueryRowContext(ctx, query).Scan(&version)
}
