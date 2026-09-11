package entity

// SSEMessage đại diện cho một gói tin chuẩn Server-Sent Events trong hệ thống.
type SSEMessage struct {
	Event string
	Data  any
}

// NodeHeartbeatEvent payload chứa thông tin nhịp tim realtime của node.
type NodeHeartbeatEvent struct {
	NodeID    string
	IP        string
	Status    string
	Sync      string
	Ruleset   string
	Timestamp int64
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
