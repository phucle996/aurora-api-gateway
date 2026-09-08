package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// UpstreamService quản lý logic nghiệp vụ cho Upstream workflow.
type UpstreamService interface {
	// CreateUpstream thẩm định, tạo mới upstream pool và sinh NGINX directive block.
	CreateUpstream(ctx context.Context, cmd entity.CreateUpstreamCommand) (*entity.UpstreamItem, error)
	// UpdateUpstream thẩm định, cập nhật upstream pool và cập nhật NGINX directive block.
	UpdateUpstream(ctx context.Context, cmd entity.UpdateUpstreamCommand) (*entity.UpstreamItem, error)
	// GetUpstream lấy chi tiết upstream theo ID.
	GetUpstream(ctx context.Context, id int64) (*entity.UpstreamItem, error)
	// ListUpstreams lấy danh sách upstreams.
	ListUpstreams(ctx context.Context, query entity.ListUpstreamsQuery) ([]entity.UpstreamItem, int, error)
	// DeleteUpstream kiểm tra, xóa upstream pool và sinh lại snapshot cấu hình NGINX.
	DeleteUpstream(ctx context.Context, id int64) error
	// GetDesiredSnapshot lấy cấu hình snapshot upstreams cho node NGINX.
	GetDesiredSnapshot(ctx context.Context, nodeID string) (*entity.UpstreamSnapshot, error)
	// ReportSyncStatus lưu trạng thái đồng bộ nhận từ node.
	ReportSyncStatus(ctx context.Context, nodeID string, releaseID int64, phase, message string) error
}
