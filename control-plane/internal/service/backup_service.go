package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"modernc.org/sqlite"
)

type BackupService = port.BackupService

type backupService struct {
	db         *sql.DB
	repo       repo.BackupRepository
	sqlitePath string
}

// NewBackupService khởi tạo service quản lý sao lưu dữ liệu và khôi phục snapshot.
func NewBackupService(db *sql.DB, repo repo.BackupRepository, sqlitePath string) BackupService {
	if db == nil {
		panic("db cannot be nil")
	}
	if repo == nil {
		panic("backupRepo cannot be nil")
	}
	return &backupService{
		db:         db,
		repo:       repo,
		sqlitePath: sqlitePath,
	}
}

// GetOverview trả về tổng quan cấu hình sao lưu và lịch sử backup.
func (s *backupService) GetOverview(ctx context.Context) (*entity.BackupOverview, error) {
	cfg, err := s.repo.GetConfig(ctx)
	if err != nil {
		return nil, err
	}
	history, err := s.repo.ListHistory(ctx, 20)
	if err != nil {
		return nil, err
	}
	return &entity.BackupOverview{
		Config:  *cfg,
		History: history,
	}, nil
}

// UpdateConfig kiểm tra tính hợp lệ của biểu thức Cron 5 trường và thông số S3 trước khi lưu.
func (s *backupService) UpdateConfig(ctx context.Context, cfg entity.BackupConfig) error {
	cfg.CronExpression = strings.TrimSpace(cfg.CronExpression)
	if cfg.CronExpression == "" {
		return errors.New("cron expression không được để trống (ví dụ: '0 2 * * *')")
	}

	if err := ValidateCron(cfg.CronExpression); err != nil {
		return fmt.Errorf("cú pháp Cron không hợp lệ: %w", err)
	}

	if cfg.S3RetentionDays < 1 {
		cfg.S3RetentionDays = 30
	}

	return s.repo.UpdateConfig(ctx, cfg)
}

// CreateLocalSnapshot tạo bản sao lưu snapshot database SQLite thực tế bằng VACUUM INTO để người dùng tải về.
func (s *backupService) CreateLocalSnapshot(ctx context.Context) ([]byte, string, error) {
	filename := fmt.Sprintf("aurora-waf-backup-%s.db", time.Now().UTC().Format("2006-01-02-150405"))

	data, err := s.generateSqliteSnapshot(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("tạo bản snapshot cơ sở dữ liệu thất bại: %w", err)
	}

	histID := fmt.Sprintf("bk_loc_%d", time.Now().UnixNano())
	histItem := entity.BackupHistoryItem{
		ID:          histID,
		Filename:    filename,
		Destination: "local",
		SizeBytes:   int64(len(data)),
		Status:      "success",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	_ = s.repo.RecordHistory(ctx, histItem)
	_ = s.repo.UpdateLastBackup(ctx, "local", "success")

	return data, filename, nil
}

// TriggerS3Backup xuất snapshot thực và gửi yêu cầu HTTP PUT lên S3 Storage qua AWS Signature V4.
func (s *backupService) TriggerS3Backup(ctx context.Context) (*entity.BackupHistoryItem, error) {
	cfg, err := s.repo.GetConfig(ctx)
	if err != nil {
		return nil, err
	}

	if !cfg.S3Enabled {
		return nil, errors.New("S3 Cloud Storage chưa được bật trong cấu hình sao lưu")
	}
	if strings.TrimSpace(cfg.S3Bucket) == "" {
		return nil, errors.New("vui lòng cấu hình S3 Bucket trước khi đẩy bản sao lưu")
	}
	if strings.TrimSpace(cfg.S3AccessKey) == "" || strings.TrimSpace(cfg.S3SecretKey) == "" {
		return nil, errors.New("vui lòng cung cấp đầy đủ S3 Access Key và Secret Key")
	}

	// 1. Tạo snapshot SQLite thực tế
	data, err := s.generateSqliteSnapshot(ctx)
	if err != nil {
		return nil, fmt.Errorf("không thể trích xuất snapshot database: %w", err)
	}

	filename := fmt.Sprintf("aurora-waf-s3-%s.db", time.Now().UTC().Format("2006-01-02-150405"))
	histID := fmt.Sprintf("bk_s3_%d", time.Now().UnixNano())

	// 2. Ký và tải file lên S3
	uploadErr := UploadSnapshotToS3(ctx, *cfg, data, filename)
	if uploadErr != nil {
		failItem := entity.BackupHistoryItem{
			ID:           histID,
			Filename:     filename,
			Destination:  "s3",
			SizeBytes:    int64(len(data)),
			Status:       "failed",
			ErrorMessage: uploadErr.Error(),
			CreatedAt:    time.Now().UTC().Format(time.RFC3339),
		}
		_ = s.repo.RecordHistory(ctx, failItem)
		_ = s.repo.UpdateLastBackup(ctx, "s3", "failed")
		return nil, uploadErr
	}

	// 3. Thực thi S3 retention nếu được cấu hình
	if cfg.S3RetentionDays > 0 {
		_, _ = PruneS3Retention(ctx, *cfg)
	}

	successItem := entity.BackupHistoryItem{
		ID:          histID,
		Filename:    filename,
		Destination: "s3",
		SizeBytes:   int64(len(data)),
		Status:      "success",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	_ = s.repo.RecordHistory(ctx, successItem)
	_ = s.repo.UpdateLastBackup(ctx, "s3", "success")

	return &successItem, nil
}

// RestoreSnapshot nhận file upload snapshot từ kéo thả, kiểm tra toàn vẹn và phục hồi dữ liệu trực tiếp vào database.
func (s *backupService) RestoreSnapshot(ctx context.Context, fileBytes []byte) (*entity.RestoreResult, error) {
	if len(fileBytes) < 512 {
		return nil, errors.New("file backup quá nhỏ hoặc không hợp lệ (kích thước tối thiểu 512 bytes)")
	}

	// Kiểm tra SQLite magic header
	expectedHeader := []byte("SQLite format 3\x00")
	if !bytes.HasPrefix(fileBytes, expectedHeader) {
		return nil, errors.New("định dạng file không phải cơ sở dữ liệu SQLite hợp lệ (thiếu SQLite Magic Header)")
	}

	// Ghi file tạm để kiểm tra tính toàn vẹn
	tempDir := os.TempDir()
	tempDB := filepath.Join(tempDir, fmt.Sprintf("restore_test_%d.db", time.Now().UnixNano()))
	if err := os.WriteFile(tempDB, fileBytes, 0600); err != nil {
		return nil, fmt.Errorf("không thể ghi file tạm phục hồi: %w", err)
	}
	defer os.Remove(tempDB)

	// Kiểm tra tính toàn vẹn với PRAGMA integrity_check và xác thực bảng Aurora API Gateway
	verifyDB, err := sql.Open("sqlite", tempDB)
	if err != nil {
		return nil, fmt.Errorf("không thể mở file snapshot kiểm tra: %w", err)
	}
	defer verifyDB.Close()

	var integrityResult string
	if err := verifyDB.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrityResult); err != nil || integrityResult != "ok" {
		return nil, fmt.Errorf("tệp cơ sở dữ liệu bị hỏng: %s", integrityResult)
	}

	var hasMigrations, hasUsers int
	_ = verifyDB.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'").Scan(&hasMigrations)
	_ = verifyDB.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='users'").Scan(&hasUsers)
	if hasMigrations == 0 || hasUsers == 0 {
		return nil, errors.New("tệp backup không chứa dữ liệu Aurora API Gateway hợp lệ (thiếu bảng schema_migrations hoặc users)")
	}

	var tableCount int
	if err := verifyDB.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tableCount); err != nil {
		return nil, fmt.Errorf("lỗi đếm bảng dữ liệu: %w", err)
	}

	var schemaVersion int
	_ = verifyDB.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&schemaVersion)

	// Đóng kết nối kiểm tra trước khi thực hiện restore
	_ = verifyDB.Close()

	// Thực hiện khôi phục trực tiếp vào live database qua NewRestore của driver
	dbConn, err := s.db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("không thể mở kết nối độc quyền phục hồi dữ liệu: %w", err)
	}
	defer dbConn.Close()

	err = dbConn.Raw(func(driverConn any) error {
		type restorer interface {
			NewRestore(srcUri string) (*sqlite.Backup, error)
		}
		r, ok := driverConn.(restorer)
		if !ok {
			return errors.New("driver SQLite không hỗ trợ API NewRestore")
		}
		bck, err := r.NewRestore(tempDB)
		if err != nil {
			return fmt.Errorf("khởi tạo đối tượng phục hồi thất bại: %w", err)
		}
		defer bck.Finish()

		more, err := bck.Step(-1)
		if err != nil {
			return fmt.Errorf("sao chép dữ liệu snapshot thất bại: %w", err)
		}
		if more {
			return errors.New("tiến trình phục hồi chưa sao chép hết các page")
		}
		return nil
	})
	if err != nil {
		_ = dbConn.Close()
		return nil, fmt.Errorf("phục hồi cơ sở dữ liệu thất bại: %w", err)
	}

	// Checkpoint WAL trên chính kết nối vừa phục hồi để đồng bộ dữ liệu vào disk
	_, _ = dbConn.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	_ = dbConn.Close()

	// Ghi nhận lịch sử phục hồi thành công
	histID := fmt.Sprintf("bk_rst_%d", time.Now().UnixNano())
	_ = s.repo.RecordHistory(ctx, entity.BackupHistoryItem{
		ID:          histID,
		Filename:    fmt.Sprintf("restored-schema-v%d-%s.db", schemaVersion, time.Now().UTC().Format("20060102-150405")),
		Destination: "restore",
		SizeBytes:   int64(len(fileBytes)),
		Status:      "success",
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	})

	return &entity.RestoreResult{
		Success:        true,
		Message:        fmt.Sprintf("Khôi phục cơ sở dữ liệu Aurora API Gateway thành công! (%d bảng dữ liệu, schema v%d)", tableCount, schemaVersion),
		RestoredTables: tableCount,
	}, nil
}

// generateSqliteSnapshot tạo bản snapshot atomic bằng câu lệnh VACUUM INTO trên kết nối SQLite đang chạy.
func (s *backupService) generateSqliteSnapshot(ctx context.Context) ([]byte, error) {
	tempFile := filepath.Join(os.TempDir(), fmt.Sprintf("aurora_snap_%d.db", time.Now().UnixNano()))
	defer os.Remove(tempFile)

	if s.db != nil {
		escaped := strings.ReplaceAll(tempFile, "'", "''")
		_, err := s.db.ExecContext(ctx, fmt.Sprintf("VACUUM INTO '%s'", escaped))
		if err == nil {
			data, readErr := os.ReadFile(tempFile)
			if readErr == nil && len(data) >= 512 && bytes.HasPrefix(data, []byte("SQLite format 3\x00")) {
				return data, nil
			}
		}
	}

	// Dự phòng: flush WAL rồi đọc trực tiếp từ sqlitePath
	if s.sqlitePath != "" {
		if s.db != nil {
			_, _ = s.db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
		}
		data, err := os.ReadFile(s.sqlitePath)
		if err == nil && len(data) >= 512 && bytes.HasPrefix(data, []byte("SQLite format 3\x00")) {
			return data, nil
		}
	}

	return nil, errors.New("không thể tạo bản snapshot SQLite atomic")
}

// =============================================================================
// Backup Cron Parser & Validator
// =============================================================================

// ValidateCron kiểm tra cú pháp của chuỗi biểu thức Cron 5 trường: phút giờ ngày tháng thứ.
func ValidateCron(expr string) error {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return fmt.Errorf("biểu thức Cron phải có đúng 5 trường cách nhau bởi dấu cách (phút giờ ngày tháng thứ), nhận được %d trường", len(fields))
	}

	limits := []struct {
		name string
		min  int
		max  int
	}{
		{"phút", 0, 59},
		{"giờ", 0, 23},
		{"ngày trong tháng", 1, 31},
		{"tháng", 1, 12},
		{"thứ trong tuần", 0, 7}, // 0 hoặc 7 đều là Chủ Nhật
	}

	for i, field := range fields {
		if err := validateCronField(field, limits[i].min, limits[i].max, limits[i].name); err != nil {
			return err
		}
	}
	return nil
}

func validateCronField(field string, min, max int, name string) error {
	if field == "*" {
		return nil
	}

	// Hỗ trợ bước nhảy */n
	if strings.HasPrefix(field, "*/") {
		stepStr := strings.TrimPrefix(field, "*/")
		step, err := strconv.Atoi(stepStr)
		if err != nil || step <= 0 || step > max {
			return fmt.Errorf("bước nhảy không hợp lệ trong trường %s: %s", name, field)
		}
		return nil
	}

	// Hỗ trợ danh sách giá trị cách nhau bằng dấu phẩy: 1,2,5
	parts := strings.Split(field, ",")
	for _, part := range parts {
		// Hỗ trợ khoảng dải: 1-5
		if strings.Contains(part, "-") {
			rangeParts := strings.Split(part, "-")
			if len(rangeParts) != 2 {
				return fmt.Errorf("dải giá trị không hợp lệ trong trường %s: %s", name, part)
			}
			start, err1 := strconv.Atoi(rangeParts[0])
			end, err2 := strconv.Atoi(rangeParts[1])
			if err1 != nil || err2 != nil || start < min || end > max || start > end {
				return fmt.Errorf("giá trị ngoài phạm vi [%d-%d] trong trường %s: %s", min, max, name, part)
			}
		} else {
			val, err := strconv.Atoi(part)
			if err != nil || val < min || val > max {
				return fmt.Errorf("giá trị ngoài phạm vi [%d-%d] trong trường %s: %s", min, max, name, part)
			}
		}
	}

	return nil
}

// MatchCron kiểm tra thời điểm t có thoả mãn biểu thức Cron hay không.
func MatchCron(expr string, t time.Time) (bool, error) {
	fields := strings.Fields(strings.TrimSpace(expr))
	if len(fields) != 5 {
		return false, fmt.Errorf("biểu thức Cron không hợp lệ: %s", expr)
	}

	minute := t.Minute()
	hour := t.Hour()
	day := t.Day()
	month := int(t.Month())
	weekday := int(t.Weekday()) // 0 = Sunday

	if !matchField(fields[0], minute) {
		return false, nil
	}
	if !matchField(fields[1], hour) {
		return false, nil
	}
	if !matchField(fields[2], day) {
		return false, nil
	}
	if !matchField(fields[3], month) {
		return false, nil
	}
	if !matchWeekday(fields[4], weekday) {
		return false, nil
	}

	return true, nil
}

func matchField(field string, val int) bool {
	if field == "*" {
		return true
	}

	if strings.HasPrefix(field, "*/") {
		step, err := strconv.Atoi(strings.TrimPrefix(field, "*/"))
		if err != nil || step <= 0 {
			return false
		}
		return val%step == 0
	}

	parts := strings.Split(field, ",")
	for _, part := range parts {
		if strings.Contains(part, "-") {
			rangeParts := strings.Split(part, "-")
			if len(rangeParts) == 2 {
				start, err1 := strconv.Atoi(rangeParts[0])
				end, err2 := strconv.Atoi(rangeParts[1])
				if err1 == nil && err2 == nil && val >= start && val <= end {
					return true
				}
			}
		} else {
			num, err := strconv.Atoi(part)
			if err == nil && num == val {
				return true
			}
		}
	}

	return false
}

func matchWeekday(field string, weekday int) bool {
	if field == "*" {
		return true
	}
	// Trong Cron, 0 và 7 đều đại diện cho Chủ Nhật
	if matchField(field, weekday) {
		return true
	}
	if weekday == 0 && matchField(field, 7) {
		return true
	}
	return false
}

// =============================================================================
// Backup Scheduler (Background Cron Goroutine)
// =============================================================================

// BackupScheduler thực thi tiến trình chạy ngầm định kỳ sao lưu dữ liệu theo biểu thức Cron cấu hình.
type BackupScheduler struct {
	svc    port.BackupService
	repo   repo.BackupRepository
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewBackupScheduler tạo mới scheduler quản lý tác vụ Cron sao lưu tự động.
func NewBackupScheduler(svc port.BackupService, repo repo.BackupRepository) *BackupScheduler {
	if svc == nil {
		panic("backupService cannot be nil")
	}
	if repo == nil {
		panic("backupRepo cannot be nil")
	}
	return &BackupScheduler{
		svc:  svc,
		repo: repo,
	}
}

// Start khởi chạy goroutine kiểm tra và thực thi sao lưu tự động theo từng phút.
func (s *BackupScheduler) Start(ctx context.Context) {
	schedCtx, cancel := context.WithCancel(ctx)
	s.cancel = cancel
	s.wg.Add(1)

	go func() {
		defer s.wg.Done()
		log.Printf("[BackupScheduler] Trình lập lịch sao lưu tự động (Cron Scheduler) đã khởi động")

		for {
			// Canh thời gian tới đầu phút tiếp theo (ví dụ: XX:YY:00 UTC)
			now := time.Now().UTC()
			nextMinute := now.Truncate(time.Minute).Add(time.Minute)
			sleepDuration := time.Until(nextMinute)

			select {
			case <-schedCtx.Done():
				log.Printf("[BackupScheduler] Trình lập lịch sao lưu tự động đang dừng...")
				return
			case <-time.After(sleepDuration):
			}

			// Thực hiện kiểm tra lịch Cron tại đầu phút
			s.runScheduledJob(schedCtx)
		}
	}()
}

// Stop dừng tiến trình scheduler một cách an toàn.
func (s *BackupScheduler) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
	s.wg.Wait()
	log.Printf("[BackupScheduler] Trình lập lịch sao lưu tự động đã dừng hoàn tất")
}

func (s *BackupScheduler) runScheduledJob(ctx context.Context) {
	cfg, err := s.repo.GetConfig(ctx)
	if err != nil {
		log.Printf("[BackupScheduler] Lỗi truy vấn cấu hình backup: %v", err)
		return
	}

	if !cfg.AutoBackupEnabled {
		return
	}

	now := time.Now().UTC()
	matched, err := MatchCron(cfg.CronExpression, now)
	if err != nil {
		log.Printf("[BackupScheduler] Biểu thức Cron không hợp lệ (%s): %v", cfg.CronExpression, err)
		return
	}

	if !matched {
		return
	}

	log.Printf("[BackupScheduler] Kích hoạt sao lưu tự động theo lịch Cron '%s' tại %s", cfg.CronExpression, now.Format(time.RFC3339))

	if cfg.S3Enabled {
		item, err := s.svc.TriggerS3Backup(ctx)
		if err != nil {
			log.Printf("[BackupScheduler] Sao lưu định kỳ lên S3 thất bại: %v", err)
		} else {
			log.Printf("[BackupScheduler] Sao lưu định kỳ lên S3 thành công: file=%s, size=%d bytes", item.Filename, item.SizeBytes)
		}
	} else {
		data, filename, err := s.svc.CreateLocalSnapshot(ctx)
		if err != nil {
			log.Printf("[BackupScheduler] Tạo bản sao lưu định kỳ thất bại: %v", err)
		} else {
			log.Printf("[BackupScheduler] Tạo bản sao lưu định kỳ thành công: file=%s, size=%d bytes", filename, len(data))
		}
	}
}

// =============================================================================
// AWS S3 Cloud Storage Client & SigV4 Protocol
// =============================================================================

type s3ErrorResponse struct {
	XMLName xml.Name `xml:"Error"`
	Code    string   `xml:"Code"`
	Message string   `xml:"Message"`
}

type s3ListBucketResult struct {
	XMLName  xml.Name    `xml:"ListBucketResult"`
	Contents []s3Content `xml:"Contents"`
}

type s3Content struct {
	Key          string    `xml:"Key"`
	LastModified time.Time `xml:"LastModified"`
	Size         int64     `xml:"Size"`
}

// UploadSnapshotToS3 thực hiện ký và gửi request HTTP PUT dữ liệu snapshot lên S3 theo chuẩn AWS Signature V4.
func UploadSnapshotToS3(ctx context.Context, cfg entity.BackupConfig, data []byte, filename string) error {
	if !cfg.S3Enabled {
		return errors.New("S3 Cloud Storage chưa được kích hoạt trong cài đặt")
	}
	if strings.TrimSpace(cfg.S3Bucket) == "" {
		return errors.New("vui lòng cấu hình S3 Bucket trước khi đẩy bản sao lưu")
	}
	if strings.TrimSpace(cfg.S3AccessKey) == "" || strings.TrimSpace(cfg.S3SecretKey) == "" {
		return errors.New("thiếu thông tin chứng thực S3 Access Key hoặc Secret Key")
	}

	endpoint := strings.TrimSpace(cfg.S3Endpoint)
	if endpoint == "" {
		endpoint = "https://s3.amazonaws.com"
	}
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		endpoint = "https://" + endpoint
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("địa chỉ S3 endpoint không hợp lệ: %w", err)
	}

	region := strings.TrimSpace(cfg.S3Region)
	if region == "" {
		region = "us-east-1"
	}

	prefix := strings.Trim(strings.TrimSpace(cfg.S3Prefix), "/")
	objectKey := filename
	if prefix != "" {
		objectKey = prefix + "/" + filename
	}

	// Xác định URL đầy đủ theo dạng Path-Style (/bucket/key)
	reqURL := fmt.Sprintf("%s://%s/%s/%s", u.Scheme, u.Host, cfg.S3Bucket, objectKey)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, reqURL, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("không thể tạo HTTP PUT request lên S3: %w", err)
	}

	now := time.Now().UTC()
	isoDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	payloadHash := sha256Hex(data)

	req.Header.Set("Host", u.Host)
	req.Header.Set("Content-Type", "application/x-sqlite3")
	req.Header.Set("Content-Length", fmt.Sprintf("%d", len(data)))
	req.Header.Set("X-Amz-Date", isoDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)

	// Ký SigV4
	canonicalURI := "/" + cfg.S3Bucket + "/" + objectKey
	signedHeaders := "content-length;content-type;host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := fmt.Sprintf(
		"content-length:%d\ncontent-type:application/x-sqlite3\nhost:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n",
		len(data), u.Host, payloadHash, isoDate,
	)

	canonicalRequest := fmt.Sprintf(
		"PUT\n%s\n\n%s\n%s\n%s",
		canonicalURI, canonicalHeaders, signedHeaders, payloadHash,
	)

	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)
	stringToSign := fmt.Sprintf(
		"AWS4-HMAC-SHA256\n%s\n%s\n%s",
		isoDate, credentialScope, sha256Hex([]byte(canonicalRequest)),
	)

	signingKey := getSignatureKey(cfg.S3SecretKey, dateStamp, region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	authHeader := fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		cfg.S3AccessKey, credentialScope, signedHeaders, signature,
	)
	req.Header.Set("Authorization", authHeader)

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("kết nối đến S3 thất bại: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode <= 204 {
		return nil
	}

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var s3Err s3ErrorResponse
	if xmlErr := xml.Unmarshal(bodyBytes, &s3Err); xmlErr == nil && (s3Err.Code != "" || s3Err.Message != "") {
		return fmt.Errorf("S3 từ chối lưu trữ (%d %s): %s - %s", resp.StatusCode, resp.Status, s3Err.Code, s3Err.Message)
	}

	return fmt.Errorf("S3 upload thất bại (mã phản hồi %d %s): %s", resp.StatusCode, resp.Status, string(bodyBytes))
}

// PruneS3Retention liệt kê và xóa các bản sao lưu đã vượt quá thời hạn retention trên S3 bucket.
func PruneS3Retention(ctx context.Context, cfg entity.BackupConfig) (int, error) {
	if !cfg.S3Enabled || cfg.S3RetentionDays <= 0 || strings.TrimSpace(cfg.S3Bucket) == "" {
		return 0, nil
	}

	endpoint := strings.TrimSpace(cfg.S3Endpoint)
	if endpoint == "" {
		endpoint = "https://s3.amazonaws.com"
	}
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		endpoint = "https://" + endpoint
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return 0, err
	}

	region := strings.TrimSpace(cfg.S3Region)
	if region == "" {
		region = "us-east-1"
	}

	prefix := strings.Trim(strings.TrimSpace(cfg.S3Prefix), "/")

	// ListObjectsV2
	queryParams := url.Values{}
	queryParams.Set("list-type", "2")
	if prefix != "" {
		queryParams.Set("prefix", prefix+"/")
	}

	reqURL := fmt.Sprintf("%s://%s/%s?%s", u.Scheme, u.Host, cfg.S3Bucket, queryParams.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return 0, err
	}

	now := time.Now().UTC()
	isoDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	emptyPayloadHash := sha256Hex([]byte(""))

	req.Header.Set("Host", u.Host)
	req.Header.Set("X-Amz-Date", isoDate)
	req.Header.Set("X-Amz-Content-Sha256", emptyPayloadHash)

	canonicalURI := "/" + cfg.S3Bucket
	canonicalQuery := queryParams.Encode()
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", u.Host, emptyPayloadHash, isoDate)

	canonicalRequest := fmt.Sprintf("GET\n%s\n%s\n%s\n%s\n%s", canonicalURI, canonicalQuery, canonicalHeaders, signedHeaders, emptyPayloadHash)
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)
	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s\n%s", isoDate, credentialScope, sha256Hex([]byte(canonicalRequest)))

	signingKey := getSignatureKey(cfg.S3SecretKey, dateStamp, region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		cfg.S3AccessKey, credentialScope, signedHeaders, signature,
	))

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return 0, nil // Bỏ qua nếu bucket không hỗ trợ list hoặc quyền hạn hạn chế
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1024*1024))
	if err != nil {
		return 0, err
	}

	var listResult s3ListBucketResult
	if err := xml.Unmarshal(body, &listResult); err != nil {
		return 0, nil
	}

	cutoff := now.AddDate(0, 0, -cfg.S3RetentionDays)
	prunedCount := 0

	for _, item := range listResult.Contents {
		if !item.LastModified.IsZero() && item.LastModified.Before(cutoff) {
			// Xoá tệp quá hạn
			delErr := deleteS3Object(ctx, u, cfg, region, item.Key)
			if delErr == nil {
				prunedCount++
			}
		}
	}

	return prunedCount, nil
}

func deleteS3Object(ctx context.Context, u *url.URL, cfg entity.BackupConfig, region, objectKey string) error {
	reqURL := fmt.Sprintf("%s://%s/%s/%s", u.Scheme, u.Host, cfg.S3Bucket, objectKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, reqURL, nil)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	isoDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	emptyPayloadHash := sha256Hex([]byte(""))

	req.Header.Set("Host", u.Host)
	req.Header.Set("X-Amz-Date", isoDate)
	req.Header.Set("X-Amz-Content-Sha256", emptyPayloadHash)

	canonicalURI := "/" + cfg.S3Bucket + "/" + objectKey
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", u.Host, emptyPayloadHash, isoDate)

	canonicalRequest := fmt.Sprintf("DELETE\n%s\n\n%s\n%s\n%s", canonicalURI, canonicalHeaders, signedHeaders, emptyPayloadHash)
	credentialScope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)
	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s\n%s", isoDate, credentialScope, sha256Hex([]byte(canonicalRequest)))

	signingKey := getSignatureKey(cfg.S3SecretKey, dateStamp, region, "s3")
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		cfg.S3AccessKey, credentialScope, signedHeaders, signature,
	))

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode <= 204 {
		return nil
	}
	return fmt.Errorf("delete failed status %d", resp.StatusCode)
}

func sha256Hex(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func getSignatureKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	kSigning := hmacSHA256(kService, []byte("aws4_request"))
	return kSigning
}
