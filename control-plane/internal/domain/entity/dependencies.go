package entity

// Tuân thủ Flat Entity: không chứa json tags.

type ListDependenciesQuery struct{}

type DependencyNode struct {
	NodeID       string
	CheckedAt    int64
	NginxVersion string
	Architecture string
	Modules      []DependencyNodeModule
	Installable  bool
	Error        string
	Fresh        bool
	JobID        int64
	JobAction    string
	JobState     string
	JobMessage   string
}

type DependencyNodeModule struct {
	Name      string
	Available bool
	Loaded    bool
	Source    string
}

type QueueDependencyCommand struct {
	NodeID string
	Action string
	Actor  string
}

type QueueDependencyResult struct {
	ID     int64
	Action string
	State  string
}

type PollDependencyQuery struct{ NodeID string }

type PollDependencyResult struct {
	ID     int64
	Action string
}

type ReportDependencyCommand struct {
	NodeID       string
	CheckedAt    int64
	NginxVersion string
	Architecture string
	Modules      []ReportDependencyModule
	Installable  bool
	Error        string
	JobID        int64
	JobState     string
	JobMessage   string
}

type ReportDependencyModule struct {
	Name      string
	Available bool
	Loaded    bool
	Source    string
}
