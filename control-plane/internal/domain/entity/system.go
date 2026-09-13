package entity

// Tuân thủ Flat Entity: không chứa json tags.

// SystemInfo là flat projection chứa toàn bộ thông tin trạng thái hoạt động của hệ thống.
type SystemInfo struct {
	Product              string
	Version              string
	Build                string
	GoVersion            string
	UptimeSeconds        int64
	UptimeFormatted      string
	Architecture         string
	StatePersistence     string
	DatabasePath         string
	DatabaseSizeBytes    int64
	DatabaseSizeFormat   string
	MemoryAllocBytes     uint64
	MemoryAllocFormatted string
}

// ControllerStatus là flat entity chứa trạng thái hoạt động của controller.
type ControllerStatus struct {
	Component        string
	Stage            string
	EnforcementReady *bool
	Message          string
}
