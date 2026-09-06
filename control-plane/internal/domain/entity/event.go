package entity

// SSEMessage đại diện cho một gói tin chuẩn Server-Sent Events trong hệ thống.
type SSEMessage struct {
	Event string
	Data  any
}

// NodeHeartbeatEvent payload chứa thông tin nhịp tim và telemetry realtime của node.
type NodeHeartbeatEvent struct {
	MetricsScope     string
	RuntimeStartedAt int64
	MetricsAvailable bool
	NodeID           string
	IP               string
	Status           string
	RPS              float64
	ActiveConns      int
	CPUUsage         float64
	MemoryUsage      float64
	Sync             string
	Ruleset          string
	Timestamp        int64
}

// NodeSyncEvent payload chứa thông tin sự kiện đồng bộ ruleset thực tế.
type NodeSyncEvent struct {
	ID        int64
	NodeID    string
	EventType string // 'release_applied', 'reload_completed', 'drift_detected'
	ReleaseID *int64
	Message   string
	CreatedAt string
}
