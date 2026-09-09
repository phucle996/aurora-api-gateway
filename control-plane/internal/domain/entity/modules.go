package entity

// Tuân thủ Flat Entity: không chứa json tags.

type ListModulesQuery struct{}

type ModuleStoreNode struct {
	NodeID       string
	CheckedAt    int64
	NginxVersion string
	Architecture string
	Modules      []ModuleStoreNodeModule
	Installable  bool
	Error        string
	Fresh        bool
	JobID        int64
	JobAction    string
	JobState     string
	JobMessage   string
	JobLogs      string
}

type ModuleStoreNodeModule struct {
	Name      string
	Available bool
	Loaded    bool
	Source    string
}

type QueueModuleJobCommand struct {
	NodeID string
	Action string
	Actor  string
}

type QueueModuleJobResult struct {
	ID     int64
	Action string
	State  string
}

type PollModuleJobQuery struct {
	NodeID string
}

type PollModuleJobResult struct {
	ID     int64
	Action string
}

type ReportModuleCommand struct {
	NodeID       string
	CheckedAt    int64
	NginxVersion string
	Architecture string
	Modules      []ReportModuleItem
	Installable  bool
	Error        string
	JobID        int64
	JobState     string
	JobMessage   string
	JobLogs      string
}

type ReportModuleItem struct {
	Name      string
	Available bool
	Loaded    bool
	Source    string
}

type ModuleJobLogsQuery struct {
	JobID int64
}

type ModuleJobLogs struct {
	ID        int64
	NodeID    string
	Action    string
	State     string
	Message   string
	Logs      string
	CreatedAt int64
	UpdatedAt int64
}
