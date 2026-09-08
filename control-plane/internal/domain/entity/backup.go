package entity

// Tuân thủ Flat Entity: không chứa json tags.

// BackupConfig định nghĩa cấu hình sao lưu dữ liệu hệ thống (Cron Job, S3 Storage, S3 Retention).
type BackupConfig struct {
	AutoBackupEnabled     bool
	CronExpression        string
	S3Enabled             bool
	S3Endpoint            string
	S3Bucket              string
	S3Region              string
	S3AccessKey           string
	S3SecretKey           string
	S3Prefix              string
	S3RetentionDays       int // Số ngày lưu trữ trên S3 bucket
	LastBackupAt          string
	LastBackupStatus      string
	LastBackupDestination string
	UpdatedAt             string
}

// BackupHistoryItem là bản ghi lịch sử sao lưu (Local Download hoặc S3 Cloud Storage).
type BackupHistoryItem struct {
	ID           string
	Filename     string
	Destination  string // "local" | "s3"
	SizeBytes    int64
	Status       string // "success" | "failed"
	ErrorMessage string
	CreatedAt    string
}

// BackupOverview là projection toàn diện trang Backup & Restore.
type BackupOverview struct {
	Config  BackupConfig
	History []BackupHistoryItem
}

// RestoreResult phản ánh kết quả phục hồi snapshot database.
type RestoreResult struct {
	Success        bool
	Message        string
	RestoredTables int
}
