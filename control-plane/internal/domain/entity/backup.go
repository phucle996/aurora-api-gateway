package entity

// BackupConfig định nghĩa cấu hình sao lưu dữ liệu hệ thống (Cron Job, S3 Storage, S3 Retention).
type BackupConfig struct {
	AutoBackupEnabled     bool   `json:"auto_backup_enabled"`
	CronExpression        string `json:"cron_expression"`
	S3Enabled             bool   `json:"s3_enabled"`
	S3Endpoint            string `json:"s3_endpoint"`
	S3Bucket              string `json:"s3_bucket"`
	S3Region              string `json:"s3_region"`
	S3AccessKey           string `json:"s3_access_key"`
	S3SecretKey           string `json:"s3_secret_key"`
	S3Prefix              string `json:"s3_prefix"`
	S3RetentionDays       int    `json:"s3_retention_days"` // Số ngày lưu trữ trên S3 bucket
	LastBackupAt          string `json:"last_backup_at"`
	LastBackupStatus      string `json:"last_backup_status"`
	LastBackupDestination string `json:"last_backup_destination"`
	UpdatedAt             string `json:"updated_at"`
}

// BackupHistoryItem là bản ghi lịch sử sao lưu (Local Download hoặc S3 Cloud Storage).
type BackupHistoryItem struct {
	ID           string `json:"id"`
	Filename     string `json:"filename"`
	Destination  string `json:"destination"` // "local" | "s3"
	SizeBytes    int64  `json:"size_bytes"`
	Status       string `json:"status"` // "success" | "failed"
	ErrorMessage string `json:"error_message"`
	CreatedAt    string `json:"created_at"`
}

// BackupOverview là projection toàn diện trang Backup & Restore.
type BackupOverview struct {
	Config  BackupConfig        `json:"config"`
	History []BackupHistoryItem `json:"history"`
}

// RestoreResult phản ánh kết quả phục hồi snapshot database.
type RestoreResult struct {
	Success        bool   `json:"success"`
	Message        string `json:"message"`
	RestoredTables int    `json:"restored_tables"`
}
