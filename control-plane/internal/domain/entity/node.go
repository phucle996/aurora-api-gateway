package entity

// ClusterNodeRecord là flat projection đại diện cho một node NGINX Data Plane
// trong cluster Aurora API Gateway.
// Tuân thủ quy tắc kiến trúc Aurora API Gateway: Flat entity, không lồng ghép đối tượng phức tạp,
// tách bạch giữa dữ liệu bền vững (SQLite) và telemetry tức thời (In-Memory/OS).
type ClusterNodeRecord struct {
	RuntimeStartedAt       int64
	WorkerIdentity         string
	ID                     string
	Name                   string
	Hostname               string
	IP                     string
	Status                 string // "Ready" | "Not Ready" | "Draining"
	Version                string
	ActiveReleaseID        *int64
	Ruleset                string
	SyncStatus             string // "In Sync" | "Drift" | "Syncing"
	LastHeartbeat          string
	LastHeartbeatTimestamp int64
	CreatedAt              string
	JoinMethod             string
	Certificate            string
	PolicySync             string
	LastSyncTime           string
	Uptime                 string
	PendingCommand         string
	ReloadStatus           string
}

// NginxMetadata đại diện cho thông tin định danh và runtime của tiến trình NGINX do node báo cáo.
type NginxMetadata struct {
	Version          string `json:"version"`
	MasterPID        int64  `json:"master_pid"`
	WorkerCount      int32  `json:"worker_count"`
	ActiveReleaseID  int64  `json:"active_release_id"`
	RuntimeStartedAt int64  `json:"runtime_started_at"`
	Hostname         string `json:"hostname"`
	Role             string `json:"role"`
	WorkerIdentity   string `json:"worker_identity"`
}

// NodeCommandDirective đại diện cho chỉ thị gửi từ Control Plane xuống Node qua response của Heartbeat.
type NodeCommandDirective struct {
	Action               string // "none" | "reload_process" | "sync_policy"
	DesiredReleaseID     int64
	MetadataAcknowledged bool
}

// RollingStatus đại diện cho tiến trình thực hiện Rolling Reload tuần tự trên các nodes.
type RollingStatus struct {
	Active         bool
	CurrentNodeID  string
	PendingNodes   []string
	CompletedNodes []string
	Message        string
}

// NodeSyncLogRecord đại diện cho một sự kiện thay đổi trạng thái đồng bộ thực tế của node trong cluster.
type NodeSyncLogRecord struct {
	ID        int64
	NodeID    string
	EventType string // "release_applied" | "reload_completed" | "drift_detected"
	ReleaseID *int64
	Message   string
	CreatedAt string
}


