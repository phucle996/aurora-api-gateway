package dto

// UpdateBackupConfigRequest mang dữ liệu cập nhật lịch trình Cron và thông số S3 storage.
type UpdateBackupConfigRequest struct {
	AutoBackupEnabled bool   `json:"auto_backup_enabled"`
	CronExpression    string `json:"cron_expression"`
	S3Enabled         bool   `json:"s3_enabled"`
	S3Endpoint        string `json:"s3_endpoint"`
	S3Bucket          string `json:"s3_bucket"`
	S3Region          string `json:"s3_region"`
	S3AccessKey       string `json:"s3_access_key"`
	S3SecretKey       string `json:"s3_secret_key"`
	S3Prefix          string `json:"s3_prefix"`
	S3RetentionDays   int    `json:"s3_retention_days"`
}
