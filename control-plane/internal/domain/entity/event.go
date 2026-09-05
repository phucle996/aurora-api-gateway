package entity

// SSEMessage đại diện cho một gói tin chuẩn Server-Sent Events.
type SSEMessage struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

// NodeHeartbeatEvent payload chứa thông tin nhịp tim và telemetry realtime của node.
type NodeHeartbeatEvent struct {
	NodeID      string  `json:"node_id"`
	IP          string  `json:"ip"`
	Status      string  `json:"status"`
	RPS         float64 `json:"rps"`
	ActiveConns int     `json:"active_conns"`
	CPUUsage    float64 `json:"cpu_usage"`
	MemoryUsage float64 `json:"memory_usage"`
	Sync        string  `json:"sync"`
	Ruleset     string  `json:"ruleset"`
	Timestamp   int64   `json:"timestamp"`
}

// NodeSyncEvent payload chứa thông tin sự kiện đồng bộ ruleset thực tế.
type NodeSyncEvent struct {
	ID        int64  `json:"id"`
	NodeID    string `json:"node_id"`
	EventType string `json:"event_type"` // 'release_applied', 'reload_completed', 'drift_detected'
	ReleaseID *int64 `json:"release_id"`
	Message   string `json:"message"`
	CreatedAt string `json:"created_at"`
}
