package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const (
	backupQueryTimeout  = 5 * time.Second  // Dành cho GetOverview truy vấn cấu hình và lịch sử
	backupConfigTimeout = 10 * time.Second // Dành cho UpdateConfig cập nhật cấu hình backup
	backupActionTimeout = 30 * time.Second // Dành cho tạo snapshot, tải file, upload S3 hoặc phục hồi
)

// BackupHandler handles backup configuration, local downloads, S3 uploads, and database restores.
type BackupHandler struct {
	service port.BackupService
}

// NewBackupHandler creates a new BackupHandler instance.
func NewBackupHandler(service port.BackupService) *BackupHandler {
	return &BackupHandler{service: service}
}

// GetOverview returns backup configuration and history.
func (h *BackupHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), backupQueryTimeout)
	defer cancel()

	overview, err := h.service.GetOverview(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "backup overview query timed out"})
			return
		}
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

// UpdateConfig updates backup scheduling, retention, and S3 credentials.
func (h *BackupHandler) UpdateConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	var req dto.UpdateBackupConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid configuration data: " + err.Error()})
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), backupConfigTimeout)
	defer cancel()

	if err := h.service.UpdateConfig(ctx, cfg); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "backup config update timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "backup configuration updated successfully"})
}

// DownloadLocalBackup exports a SQLite database snapshot as a binary download.
func (h *BackupHandler) DownloadLocalBackup(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), backupActionTimeout)
	defer cancel()

	data, filename, err := h.service.CreateLocalSnapshot(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "local snapshot creation timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create snapshot: " + err.Error()})
		return
	}

	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))
	c.Header("Content-Type", "application/x-sqlite3")
	c.Header("Content-Length", fmt.Sprintf("%d", len(data)))
	c.Data(http.StatusOK, "application/x-sqlite3", data)
}

// TriggerS3Backup triggers an immediate database snapshot upload to S3.
func (h *BackupHandler) TriggerS3Backup(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), backupActionTimeout)
	defer cancel()

	item, err := h.service.TriggerS3Backup(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "S3 backup trigger timed out"})
			return
		}
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

// RestoreSnapshot restores the database from an uploaded backup snapshot.
func (h *BackupHandler) RestoreSnapshot(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "please select a backup file to restore: " + err.Error()})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unable to open uploaded file: " + err.Error()})
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read file content: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), backupActionTimeout)
	defer cancel()

	result, err := h.service.RestoreSnapshot(ctx, fileBytes)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "snapshot restore timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success":         result.Success,
		"message":         result.Message,
		"restored_tables": result.RestoredTables,
	})
}
