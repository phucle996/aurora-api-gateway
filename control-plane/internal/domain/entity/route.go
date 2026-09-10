package entity

// Tuân thủ Flat Entity: không chứa json tags.

// RouteItem là flat projection entity đại diện cho một Route định tuyến (1-1 với Upstream).
type RouteItem struct {
	ID           string
	Name         string
	Host         string
	Path         string
	UpstreamName string
	Enabled      bool
	StripPath    bool
	WebSocket    bool
	Priority     int
	PluginsJSON  string
	Description  string
	CreatedAt    string
	UpdatedAt    string
}

// CreateRouteCommand chứa dữ liệu để khởi tạo một Route mới.
type CreateRouteCommand struct {
	ID           string
	Name         string
	Host         string
	Path         string
	UpstreamName string
	Enabled      bool
	StripPath    bool
	WebSocket    bool
	Priority     int
	PluginsJSON  string
	Description  string
}

// UpdateRouteCommand chứa dữ liệu để cập nhật Route hiện có.
type UpdateRouteCommand struct {
	ID           string
	Name         string
	Host         string
	Path         string
	UpstreamName string
	Enabled      bool
	StripPath    bool
	WebSocket    bool
	Priority     int
	PluginsJSON  string
	Description  string
}

// ListRoutesQuery chứa các điều kiện lọc và phân trang danh sách Route.
type ListRoutesQuery struct {
	Search       string
	Host         string
	UpstreamName string
	Limit        int
	Offset       int
}

// ListRoutesResult chứa danh sách Route và tổng số lượng bản ghi thỏa mãn.
type ListRoutesResult struct {
	Items []RouteItem
	Total int
}
