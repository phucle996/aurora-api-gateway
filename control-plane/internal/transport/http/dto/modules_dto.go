package dto

// QueueModuleJobRequest là body yêu cầu queue một module job cho node.
type QueueModuleJobRequest struct {
	Action string `json:"action" binding:"required"`
}

// ReportModuleItemRequest là thông tin module trong gói báo cáo từ node.
type ReportModuleItemRequest struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Loaded    bool   `json:"loaded"`
	Source    string `json:"source"`
}

// ReportModuleRequest là payload báo cáo trạng thái modules do daemon node gửi lên.
type ReportModuleRequest struct {
	CheckedAt    int64                     `json:"checked_at"`
	NginxVersion string                    `json:"nginx_version"`
	Architecture string                    `json:"architecture"`
	Modules      []ReportModuleItemRequest `json:"modules"`
	Installable  bool                      `json:"installable"`
	Error        string                    `json:"error"`
	JobID        int64                     `json:"job_id"`
	JobState     string                    `json:"job_state"`
	JobMessage   string                    `json:"job_message"`
	JobLogs      string                    `json:"job_logs"`
}

// AppendModuleJobLogRequest là body gửi log chunk và tiến trình từng bước từ node agent lên.
type AppendModuleJobLogRequest struct {
	Stage    string `json:"stage"`
	Progress int    `json:"progress"`
	Message  string `json:"message"`
	LogChunk string `json:"log_chunk"`
}

// SetModuleDesiredRequest là payload thiết lập trạng thái mong muốn cho một module (fleet-wide generic).
type SetModuleDesiredRequest struct {
	Enabled bool `json:"enabled"`
}

// TriggerModuleSyncRequest là payload kích hoạt đồng bộ fanout cho module.
type TriggerModuleSyncRequest struct {
	Module string `json:"module"`
}
