package entity

// ClusterNodeRecord là flat projection đại diện cho một node NGINX Data Plane
// trong cluster Aurora WAF.
// Tuân thủ quy tắc kiến trúc Aurora WAF: Flat entity, không lồng ghép đối tượng phức tạp,
// tách bạch giữa dữ liệu bền vững (SQLite) và telemetry tức thời (In-Memory/OS).
type ClusterNodeRecord struct {
	MetricsScope           string
	RuntimeStartedAt       int64
	WorkerIdentity         string
	MetricsAvailable       bool
	ID                     string
	Name                   string
	Hostname               string
	IP                     string
	Role                   string
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
	CPUUsage               float64
	MemoryUsage            float64
	ActiveConnections      string
	RequestsPerSecond      string
	Uptime                 string
	PendingCommand         string
	ReloadStatus           string
}

// NodeCommandDirective đại diện cho chỉ thị gửi từ Control Plane xuống Node qua response của Heartbeat.
type NodeCommandDirective struct {
	Action           string // "none" | "reload_process" | "sync_policy"
	DesiredReleaseID int64
}

// ClusterRollingStatus đại diện cho tiến trình thực hiện Rolling Reload tuần tự trên toàn cụm.
type ClusterRollingStatus struct {
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

// NodeHeartbeatState is the heartbeat workflow's persisted observation boundary.
type NodeHeartbeatState struct {
	ActiveReleaseID *int64
	Timestamp       int64
	ReloadStatus    string
	WorkerIdentity  string
}
