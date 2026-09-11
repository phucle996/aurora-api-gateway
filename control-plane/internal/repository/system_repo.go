package repository

import (
	"context"
	"database/sql"
	"errors"

	"aurora-waf.local/control-plane/internal/domain/repo"
)

// SystemRepository triển khai cổng lưu trữ repo.SystemRepository.
type SystemRepository struct {
	reader *sql.DB
}

// NewSystemRepository khởi tạo SystemRepository với reader database pool.
func NewSystemRepository(reader *sql.DB) repo.SystemRepository {
	return &SystemRepository{reader: reader}
}

// Check thực hiện kiểm tra kết nối CSDL và xác nhận rằng hệ thống đã hoàn tất di trú schema ban đầu (version = 1).
func (r *SystemRepository) Check(ctx context.Context) error {
	if r.reader == nil {
		return errors.New("database reader is nil")
	}
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
	return r.reader.QueryRowContext(ctx, query).Scan(&version)
}

// GetNodeCounts đếm tổng số node và số node ở trạng thái sẵn sàng trong cluster.
func (r *SystemRepository) GetNodeCounts(ctx context.Context) (int, int, error) {
	if r.reader == nil {
		return 0, 0, nil
	}
	var total, ready int
	if err := r.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM cluster_nodes;").Scan(&total); err != nil {
		return 0, 0, err
	}
	if err := r.reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM cluster_nodes WHERE status IN ('Ready', 'healthy', 'online');").Scan(&ready); err != nil {
		return total, 0, err
	}
	return total, ready, nil
}
