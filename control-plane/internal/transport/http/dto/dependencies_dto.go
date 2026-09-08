package dto

// QueueDependencyRequest là body yêu cầu queue một dependency job cho node.
type QueueDependencyRequest struct {
	Action string `json:"action" binding:"required"`
}

// ReportDependencyModuleRequest là thông tin module trong gói báo cáo từ node.
type ReportDependencyModuleRequest struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Loaded    bool   `json:"loaded"`
	Source    string `json:"source"`
}

// ReportDependencyRequest là payload báo cáo trạng thái dependencies do daemon node gửi lên.
type ReportDependencyRequest struct {
	CheckedAt    int64                           `json:"checked_at"`
	NginxVersion string                          `json:"nginx_version"`
	Architecture string                          `json:"architecture"`
	Modules      []ReportDependencyModuleRequest `json:"modules"`
	Installable  bool                            `json:"installable"`
	Error        string                          `json:"error"`
	JobID        int64                           `json:"job_id"`
	JobState     string                          `json:"job_state"`
	JobMessage   string                          `json:"job_message"`
}
