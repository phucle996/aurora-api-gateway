package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"github.com/gin-gonic/gin"
)

const backupTestToken = "test-token-at-least-32-bytes-long-backup"

func backupFixture(t *testing.T) (http.Handler, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "backup_test.db")
	a, err := app.NewApp(context.Background(), config.Config{
		SQLitePath: path,
		JWTSecret:  backupTestToken,
	})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()

	pools, err := infra.OpenSQLitePool(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pools.Close() })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	cfg := config.Config{
		SQLitePath: path,
		JWTSecret:  backupTestToken,
	}
	module := app.NewModule(pools.Writer, pools.Reader, cfg)
	app.RegisterRoutes(router, module, backupTestToken)
	return router, path
}

func TestBackupWorkflow_EndToEnd(t *testing.T) {
	handler, _ := backupFixture(t)

	// 1. GET /api/v1/settings/backup
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/backup", nil)
	req.Header.Set("Authorization", "Bearer "+backupTestToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var overview entity.BackupOverview
	if err := json.Unmarshal(w.Body.Bytes(), &overview); err != nil {
		t.Fatalf("failed to unmarshal overview: %v", err)
	}

	if overview.Config.CronExpression != "0 2 * * *" {
		t.Fatalf("expected cron '0 2 * * *', got '%s'", overview.Config.CronExpression)
	}
	if overview.Config.S3RetentionDays != 30 {
		t.Fatalf("expected S3 retention 30, got %d", overview.Config.S3RetentionDays)
	}

	// Mock S3 server verifying real AWS SigV4 PUT requests and SQLite data payload
	var s3UploadedBytes []byte
	var s3AuthHeader string
	mockS3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s3AuthHeader = r.Header.Get("Authorization")
		if r.Method == http.MethodPut {
			data, _ := io.ReadAll(r.Body)
			s3UploadedBytes = data
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.Method == http.MethodGet {
			// Mock ListObjectsV2 response for S3 retention
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></ListBucketResult>`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer mockS3.Close()

	// 2. PUT /api/v1/settings/backup/config
	updatePayload := map[string]interface{}{
		"auto_backup_enabled": true,
		"cron_expression":     "0 */6 * * *",
		"s3_enabled":          true,
		"s3_endpoint":         mockS3.URL,
		"s3_bucket":           "corp-aurora-backups",
		"s3_region":           "us-east-1",
		"s3_access_key":       "AKIAIOSFODNN7EXAMPLE",
		"s3_secret_key":       "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
		"s3_prefix":           "waf-clusters/prod/",
		"s3_retention_days":   60,
	}
	bodyBytes, _ := json.Marshal(updatePayload)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/settings/backup/config", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+backupTestToken)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on update config, got %d: %s", w.Code, w.Body.String())
	}

	// 3. Verify updated config
	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings/backup", nil)
	req.Header.Set("Authorization", "Bearer "+backupTestToken)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	t.Log("Step 3: Verify updated config")
	var updatedOverview entity.BackupOverview
	_ = json.Unmarshal(w.Body.Bytes(), &updatedOverview)
	if updatedOverview.Config.CronExpression != "0 */6 * * *" {
		t.Fatalf("expected cron '0 */6 * * *', got '%s'", updatedOverview.Config.CronExpression)
	}
	if updatedOverview.Config.S3RetentionDays != 60 {
		t.Fatalf("expected retention 60, got %d", updatedOverview.Config.S3RetentionDays)
	}

	// 4. Download local backup GET /api/v1/settings/backup/download
	t.Log("Step 4: Download local backup")
	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings/backup/download", nil)
	req.Header.Set("Authorization", "Bearer "+backupTestToken)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on download, got %d: %s", w.Code, w.Body.String())
	}
	downloadedBytes := w.Body.Bytes()
	if len(downloadedBytes) < 16 || string(downloadedBytes[:16]) != "SQLite format 3\x00" {
		t.Fatalf("expected SQLite format header in downloaded file, got length %d", len(downloadedBytes))
	}

	// 5. Test Trigger S3 backup POST /api/v1/settings/backup/s3/upload
	t.Log("Step 5: Trigger S3 backup")
	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/backup/s3/upload", nil)
	req.Header.Set("Authorization", "Bearer "+backupTestToken)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on S3 upload, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.HasPrefix(s3AuthHeader, "AWS4-HMAC-SHA256") {
		t.Fatalf("expected AWS SigV4 authorization header, got: %s", s3AuthHeader)
	}
	if len(s3UploadedBytes) < 16 || string(s3UploadedBytes[:16]) != "SQLite format 3\x00" {
		t.Fatalf("expected SQLite payload in S3 upload, got %d bytes", len(s3UploadedBytes))
	}

	// 6. Test Restore with Drag & Drop POST /api/v1/settings/backup/restore
	t.Log("Step 6: Restore snapshot")
	var b bytes.Buffer
	writer := multipart.NewWriter(&b)
	part, err := writer.CreateFormFile("file", "aurora-restore.db")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(downloadedBytes)
	_ = writer.Close()

	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/backup/restore", &b)
	req.Header.Set("Authorization", "Bearer "+backupTestToken)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on restore, got %d: %s", w.Code, w.Body.String())
	}

	var restoreRes entity.RestoreResult
	if err := json.Unmarshal(w.Body.Bytes(), &restoreRes); err != nil {
		t.Fatalf("failed to unmarshal restore response: %v", err)
	}
	if !restoreRes.Success {
		t.Fatalf("expected restore success, got: %s", restoreRes.Message)
	}
}
