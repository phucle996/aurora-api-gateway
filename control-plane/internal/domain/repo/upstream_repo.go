package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// UpstreamRepository định nghĩa cổng lưu trữ cho Upstream workflow (CTE-first).
type UpstreamRepository interface {
	// Create lưu trữ upstream pool mới trong transaction và tạo bản ghi upstream_releases mới.
	Create(ctx context.Context, cmd entity.CreateUpstreamCommand, generatedConf string, digest string) (*entity.UpstreamItem, error)
	// Update cập nhật upstream pool trong transaction và tạo bản ghi upstream_releases mới.
	Update(ctx context.Context, cmd entity.UpdateUpstreamCommand, generatedConf string, digest string) (*entity.UpstreamItem, error)
	// GetByID lấy chi tiết một upstream theo ID.
	GetByID(ctx context.Context, id int64) (*entity.UpstreamItem, error)
	// GetByName lấy chi tiết một upstream theo tên duy nhất.
	GetByName(ctx context.Context, name string) (*entity.UpstreamItem, error)
	// List lấy danh sách upstream phục vụ dropdown và trang quản lý.
	List(ctx context.Context, query entity.ListUpstreamsQuery) ([]entity.UpstreamItem, int, error)
	// GetLatestSnapshot lấy snapshot cấu hình upstreams mới nhất kèm SHA-256 digest.
	GetLatestSnapshot(ctx context.Context) (*entity.UpstreamSnapshot, error)
	// Delete xóa upstream pool và ghi nhận snapshot release mới cho NGINX Data Plane.
	Delete(ctx context.Context, id int64, generatedConf string, digest string) error
	// RecordNodeSync lưu lại kết quả đồng bộ từ node Data Plane.
	RecordNodeSync(ctx context.Context, nodeID string, releaseID int64, phase, message string) error
}
