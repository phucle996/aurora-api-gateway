package dto

// ClusterNodeResponse represents HTTP wire schema for a single cluster node.
type ClusterNodeResponse struct {
	MetricsScope           string  `json:"metricsScope"`
	RuntimeStartedAt       int64   `json:"runtimeStartedAt"`
	MetricsAvailable       bool    `json:"metricsAvailable"`
	ID                     string  `json:"id"`
	Name                   string  `json:"name"`
	Hostname               string  `json:"hostname"`
	IP                     string  `json:"ip"`
	Status                 string  `json:"status"`
	Version                string  `json:"version"`
	ActiveReleaseID        *int64  `json:"active_release_id,omitempty"`
	Ruleset                string  `json:"ruleset"`
	SyncStatus             string  `json:"sync"`
	LastHeartbeat          string  `json:"lastHeartbeat"`
	LastHeartbeatTimestamp int64   `json:"lastHeartbeatTimestamp"`
	CreatedAt              string  `json:"created_at"`
	JoinMethod             string  `json:"joinMethod"`
	Certificate            string  `json:"certificate"`
	PolicySync             string  `json:"policySync"`
	LastSyncTime           string  `json:"lastSyncTime"`
	CPUUsage               float64 `json:"cpuUsage"`
	MemoryUsage            float64 `json:"memoryUsage"`
	ActiveConnections      string  `json:"activeConnections"`
	RequestsPerSecond      string  `json:"requestsPerSecond"`
	Uptime                 string  `json:"uptime"`
	PendingCommand         string  `json:"pendingCommand,omitempty"`
	ReloadStatus           string  `json:"reloadStatus,omitempty"`
}

// NodeCommandDirectiveResponse represents HTTP wire directive returned from heartbeat.
type NodeCommandDirectiveResponse struct {
	Action           string `json:"action"`
	DesiredReleaseID int64  `json:"desired_release_id,omitempty"`
}

// ClusterRollingStatusResponse represents HTTP wire status of cluster rolling reload.
type ClusterRollingStatusResponse struct {
	Active         bool     `json:"active"`
	CurrentNodeID  string   `json:"currentNodeId,omitempty"`
	PendingNodes   []string `json:"pendingNodes"`
	CompletedNodes []string `json:"completedNodes"`
	Message        string   `json:"message"`
}

// NodeSyncLogResponse represents HTTP wire record for node sync history.
type NodeSyncLogResponse struct {
	ID        int64  `json:"id"`
	NodeID    string `json:"node_id"`
	EventType string `json:"event_type"`
	ReleaseID *int64 `json:"release_id,omitempty"`
	Message   string `json:"message"`
	CreatedAt string `json:"created_at"`
}

// NodeHeartbeatEventResponse represents the SSE JSON payload for batched node heartbeats.
type NodeHeartbeatEventResponse struct {
	MetricsScope     string  `json:"metrics_scope"`
	RuntimeStartedAt int64   `json:"runtime_started_at"`
	MetricsAvailable bool    `json:"metrics_available"`
	NodeID           string  `json:"node_id"`
	IP               string  `json:"ip"`
	Status           string  `json:"status"`
	RPS              float64 `json:"rps"`
	ActiveConns      int     `json:"active_conns"`
	CPUUsage         float64 `json:"cpu_usage"`
	MemoryUsage      float64 `json:"memory_usage"`
	Sync             string  `json:"sync"`
	Ruleset          string  `json:"ruleset"`
	Timestamp        int64   `json:"timestamp"`
}

// NodeSyncEventResponse represents the SSE JSON payload for node synchronization events.
type NodeSyncEventResponse struct {
	ID        int64  `json:"id"`
	NodeID    string `json:"node_id"`
	EventType string `json:"event_type"`
	ReleaseID *int64 `json:"release_id,omitempty"`
	Message   string `json:"message"`
	CreatedAt string `json:"created_at"`
}
