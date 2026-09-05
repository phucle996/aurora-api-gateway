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
}
