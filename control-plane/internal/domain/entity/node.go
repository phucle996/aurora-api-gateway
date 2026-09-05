package entity

// ClusterNodeRecord là flat projection đại diện cho một node NGINX Data Plane
// trong cluster Aurora WAF.
// Tuân thủ quy tắc kiến trúc Aurora WAF: Flat entity, không lồng ghép đối tượng phức tạp,
// tách bạch giữa dữ liệu bền vững (SQLite) và telemetry tức thời (In-Memory/OS).
type ClusterNodeRecord struct {
	ID                string  `json:"id"`
	Name              string  `json:"name"`
	Hostname          string  `json:"hostname"`
	IP                string  `json:"ip"`
	Role              string  `json:"role"`
	Status            string  `json:"status"` // "Ready" | "Not Ready" | "Draining"
	Version           string  `json:"version"`
	ActiveReleaseID   *int64  `json:"active_release_id,omitempty"`
	Ruleset           string  `json:"ruleset"`
	SyncStatus        string  `json:"sync"` // "In Sync" | "Drift" | "Syncing"
	LastHeartbeat     string  `json:"lastHeartbeat"`
	CreatedAt         string  `json:"created_at"`
	JoinMethod        string  `json:"joinMethod"`
	Certificate       string  `json:"certificate"`
	PolicySync        string  `json:"policySync"`
	LastSyncTime      string  `json:"lastSyncTime"`
	CPUUsage          float64 `json:"cpuUsage"`
	MemoryUsage       float64 `json:"memoryUsage"`
	ActiveConnections string  `json:"activeConnections"`
	RequestsPerSecond string  `json:"requestsPerSecond"`
	Uptime            string  `json:"uptime"`
	PendingCommand    string  `json:"pendingCommand,omitempty"`
	ReloadStatus      string  `json:"reloadStatus,omitempty"`
}

// NodeCommandDirective đại diện cho chỉ thị gửi từ Control Plane xuống Node qua response của Heartbeat.
type NodeCommandDirective struct {
	Action           string `json:"action"` // "none" | "reload_process" | "sync_policy"
	DesiredReleaseID int64  `json:"desired_release_id,omitempty"`
}

// ClusterRollingStatus đại diện cho tiến trình thực hiện Rolling Reload tuần tự trên toàn cụm.
type ClusterRollingStatus struct {
	Active         bool     `json:"active"`
	CurrentNodeID  string   `json:"currentNodeId,omitempty"`
	PendingNodes   []string `json:"pendingNodes"`
	CompletedNodes []string `json:"completedNodes"`
	Message        string   `json:"message"`
}
