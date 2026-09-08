package entity

type ListDependenciesQuery struct{}
type DependencyNode struct {
	NodeID       string                 `json:"node_id"`
	CheckedAt    int64                  `json:"checked_at"`
	NginxVersion string                 `json:"nginx_version"`
	Architecture string                 `json:"architecture"`
	Modules      []DependencyNodeModule `json:"modules"`
	Installable  bool                   `json:"installable"`
	Error        string                 `json:"error"`
	Fresh        bool                   `json:"fresh"`
	JobID        int64                  `json:"job_id"`
	JobAction    string                 `json:"job_action"`
	JobState     string                 `json:"job_state"`
	JobMessage   string                 `json:"job_message"`
}
type DependencyNodeModule struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Loaded    bool   `json:"loaded"`
	Source    string `json:"source"`
}
type QueueDependencyCommand struct {
	NodeID string
	Action string
	Actor  string
}
type QueueDependencyResult struct {
	ID     int64  `json:"id"`
	Action string `json:"action"`
	State  string `json:"state"`
}
type PollDependencyQuery struct{ NodeID string }
type PollDependencyResult struct {
	ID     int64  `json:"id"`
	Action string `json:"action"`
}
type ReportDependencyCommand struct {
	NodeID       string                   `json:"-"`
	CheckedAt    int64                    `json:"checked_at"`
	NginxVersion string                   `json:"nginx_version"`
	Architecture string                   `json:"architecture"`
	Modules      []ReportDependencyModule `json:"modules"`
	Installable  bool                     `json:"installable"`
	Error        string                   `json:"error"`
	JobID        int64                    `json:"job_id"`
	JobState     string                   `json:"job_state"`
	JobMessage   string                   `json:"job_message"`
}
type ReportDependencyModule struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Loaded    bool   `json:"loaded"`
	Source    string `json:"source"`
}
