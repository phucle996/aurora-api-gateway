package repo

import "context"

// SystemRepository định nghĩa port truy xuất dữ liệu độc lập cho System workflow.
type SystemRepository interface {
	Check(ctx context.Context) error
	GetNodeCounts(ctx context.Context) (total int, ready int, err error)
}
