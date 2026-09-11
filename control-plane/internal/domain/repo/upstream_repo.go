package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// UpstreamRepository định nghĩa cổng lưu trữ cho Upstream workflow (CTE-first).
type UpstreamRepository interface {
	// Create lưu trữ upstream pool mới trong transaction.
	Create(ctx context.Context, cmd entity.CreateUpstreamCommand) (*entity.UpstreamItem, error)
	// Update cập nhật upstream pool trong transaction.
	Update(ctx context.Context, cmd entity.UpdateUpstreamCommand) (*entity.UpstreamItem, error)
	// GetByID lấy chi tiết một upstream theo ID.
	GetByID(ctx context.Context, id int64) (*entity.UpstreamItem, error)
	// GetByName lấy chi tiết một upstream theo tên duy nhất.
	GetByName(ctx context.Context, name string) (*entity.UpstreamItem, error)
	// List lấy danh sách upstream phục vụ dropdown và trang quản lý.
	List(ctx context.Context, query entity.ListUpstreamsQuery) ([]entity.UpstreamItem, int, error)
	// Delete xóa upstream pool.
	Delete(ctx context.Context, id int64) error
}
