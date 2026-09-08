package handler

import (
	"fmt"
	"io"
	"net/http"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// BackupHandler xử lý các API endpoint sao lưu dữ liệu, xuất file download, đẩy S3 và phục hồi snapshot.
type BackupHandler struct {
	service port.BackupService
}

// NewBackupHandler khởi tạo handler cho module Backup & Restore.
func NewBackupHandler(service port.BackupService) *BackupHandler {
	return &BackupHandler{service: service}
}

// GetOverview trả về toàn bộ thông số cấu hình sao lưu và lịch sử các lần backup dưới dạng gin.H inline.
func (h *BackupHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	overview, err := h.service.GetOverview(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	historyList := make([]gin.H, len(overview.History))
	for i, hItem := range overview.History {
		historyList[i] = gin.H{
			"id":            hItem.ID,
			"filename":      hItem.Filename,
			"destination":   hItem.Destination,
			"size_bytes":    hItem.SizeBytes,
			"status":        hItem.Status,
			"error_message": hItem.ErrorMessage,
			"created_at":    hItem.CreatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"config": gin.H{
			"auto_backup_enabled":     overview.Config.AutoBackupEnabled,
			"cron_expression":         overview.Config.CronExpression,
			"s3_enabled":              overview.Config.S3Enabled,
			"s3_endpoint":             overview.Config.S3Endpoint,
			"s3_bucket":               overview.Config.S3Bucket,
			"s3_region":               overview.Config.S3Region,
			"s3_access_key":           overview.Config.S3AccessKey,
			"s3_secret_key":           overview.Config.S3SecretKey,
			"s3_prefix":               overview.Config.S3Prefix,
			"s3_retention_days":       overview.Config.S3RetentionDays,
			"last_backup_at":          overview.Config.LastBackupAt,
			"last_backup_status":      overview.Config.LastBackupStatus,
			"last_backup_destination": overview.Config.LastBackupDestination,
			"updated_at":              overview.Config.UpdatedAt,
		},
		"history": historyList,
	})
}

// UpdateConfig cập nhật cấu hình Cron Job, bật/tắt S3 và số ngày retention.
func (h *BackupHandler) UpdateConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	var req dto.UpdateBackupConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu cấu hình không hợp lệ: " + err.Error()})
		return
	}

	cfg := entity.BackupConfig{
		AutoBackupEnabled: req.AutoBackupEnabled,
		CronExpression:    req.CronExpression,
		S3Enabled:         req.S3Enabled,
		S3Endpoint:        req.S3Endpoint,
		S3Bucket:          req.S3Bucket,
		S3Region:          req.S3Region,
		S3AccessKey:       req.S3AccessKey,
		S3SecretKey:       req.S3SecretKey,
		S3Prefix:          req.S3Prefix,
		S3RetentionDays:   req.S3RetentionDays,
	}

	if err := h.service.UpdateConfig(c.Request.Context(), cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Cập nhật cấu hình sao lưu thành công"})
}

// DownloadLocalBackup xuất file cơ sở dữ liệu SQLite và truyền về máy người dùng dưới dạng binary attachment.
func (h *BackupHandler) DownloadLocalBackup(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	data, filename, err := h.service.CreateLocalSnapshot(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Không thể tạo bản sao lưu: " + err.Error()})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Header("Content-Type", "application/x-sqlite3")
	c.Header("Content-Length", fmt.Sprintf("%d", len(data)))
	c.Data(http.StatusOK, "application/x-sqlite3", data)
}

// TriggerS3Backup xuất snapshot và đẩy trực tiếp lên S3 storage.
func (h *BackupHandler) TriggerS3Backup(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	item, err := h.service.TriggerS3Backup(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":            item.ID,
		"filename":      item.Filename,
		"destination":   item.Destination,
		"size_bytes":    item.SizeBytes,
		"status":        item.Status,
		"error_message": item.ErrorMessage,
		"created_at":    item.CreatedAt,
	})
}

// RestoreSnapshot nhận file upload từ kéo thả (Drag & Drop) hoặc browse file để phục hồi database.
func (h *BackupHandler) RestoreSnapshot(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Vui lòng chọn file backup để phục hồi: " + err.Error()})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Không thể đọc file upload: " + err.Error()})
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi đọc dữ liệu file: " + err.Error()})
		return
	}

	result, err := h.service.RestoreSnapshot(c.Request.Context(), fileBytes)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":         result.Success,
		"message":         result.Message,
		"restored_tables": result.RestoredTables,
	})
}
