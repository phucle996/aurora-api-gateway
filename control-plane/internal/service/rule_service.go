package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os/exec"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// ruleService là struct duy nhất chịu trách nhiệm xử lý toàn bộ nghiệp vụ (business logic)
// của đối tượng Rule và Release:
//   - Kiểm tra tính hợp lệ dữ liệu đầu vào (validation)
//   - Điều phối việc lưu trữ thông qua repo.RuleRepository
//   - Đảm bảo an toàn luồng khi publish rule ra cấu hình NGINX (sử dụng gate mutex)
type ruleService struct {
	repo     repo.RuleRepository
	compiler string     // Đường dẫn file thực thi compiler (aurora-compile)
	gate     sync.Mutex // Đảm bảo chỉ 1 tiến trình publish chạy tại 1 thời điểm
}

// NewRuleService là constructor duy nhất để khởi tạo RuleService.
// Nhận vào repository và đường dẫn binary compiler.
func NewRuleService(r repo.RuleRepository, compiler string) port.RuleService {
	return &ruleService{repo: r, compiler: compiler}
}

// ─── 1. Danh sách Rules (List) ────────────────────────────────────────────────

// List kiểm tra các bộ lọc (filter) và lấy danh sách rule phân trang từ DB.
// Kiểm tra giới hạn: số lượng bản ghi (1..100), độ dài từ khóa tìm kiếm,
// nhóm rule, hành vi (action) và mức độ nghiêm trọng (severity).
func (s *ruleService) List(ctx context.Context, q entity.ListRulesQuery) (entity.ListRulesResult, error) {
	if q.Limit < 1 || q.Limit > 100 || q.After < 0 || len(q.Search) > 120 || (q.Enabled != "" && q.Enabled != "true" && q.Enabled != "false") {
		return entity.ListRulesResult{}, entity.ErrRuleInvalid
	}
	switch q.Group {
	case "", "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
	default:
		return entity.ListRulesResult{}, entity.ErrRuleInvalid
	}
	switch q.Action {
	case "", "allow", "block", "log":
	default:
		return entity.ListRulesResult{}, entity.ErrRuleInvalid
	}
	switch q.Severity {
	case "", "low", "medium", "high", "critical":
	default:
		return entity.ListRulesResult{}, entity.ErrRuleInvalid
	}
	return s.repo.List(ctx, q)
}

// ─── 2. Chi tiết Rule (Detail) ────────────────────────────────────────────────

// Detail lấy thông tin chi tiết của một rule theo ID.
// Kiểm tra ID phải là số dương hợp lệ trước khi truy vấn DB.
func (s *ruleService) Detail(ctx context.Context, q entity.RuleDetailQuery) (entity.RuleDetailResult, error) {
	if q.ID < 1 {
		return entity.RuleDetailResult{}, entity.ErrRuleInvalid
	}
	return s.repo.Detail(ctx, q)
}

// ─── 3. Thống kê Rules (Stats) ────────────────────────────────────────────────

// Stats tính toán số liệu thống kê tổng quan (tổng rule, bật/tắt, phân loại theo action)
// tính đến mốc thời gian hiện tại (AsOf).
func (s *ruleService) Stats(ctx context.Context, q entity.RuleStatsQuery) (entity.RuleStatsResult, error) {
	q.AsOf = time.Now().UTC()
	return s.repo.Stats(ctx, q)
}

// ─── 4. Lịch sử thay đổi Rule (History) ───────────────────────────────────────

// History truy vấn các phiên bản chỉnh sửa trước đây của một rule.
// Hỗ trợ phân trang lùi qua con trỏ `Before` và giới hạn số lượng `Limit`.
func (s *ruleService) History(ctx context.Context, q entity.RuleHistoryQuery) (entity.RuleHistoryResult, error) {
	if q.ID < 1 || q.Before < 0 || q.Limit < 1 || q.Limit > 100 {
		return entity.RuleHistoryResult{}, entity.ErrRuleInvalid
	}
	return s.repo.History(ctx, q)
}

// ─── 5. Tạo mới Rule (Create) ─────────────────────────────────────────────────

// Create kiểm tra tính hợp lệ toàn diện của rule mới trước khi ghi vào database:
//   - Idempotency key (tránh tạo lặp)
//   - Tên và mô tả hợp lệ theo chuẩn UTF-8
//   - Điểm số (Score: 0..1000) và độ ưu tiên (Priority: 0..1000000)
//   - Đường dẫn URL hợp lệ (bắt đầu bằng '/', không chứa ký tự cấm, không chứa .. hoặc //)
//   - Hành vi (allow, log, block), mức độ và nhóm rule hợp lệ
func (s *ruleService) Create(ctx context.Context, c entity.CreateRuleCommand) (entity.CreateRuleResult, error) {
	if len(c.RequestKey) < 16 || len(c.RequestKey) > 128 ||
		strings.TrimSpace(c.Name) == "" || len(c.Name) > 120 || !utf8.ValidString(c.Name) || len(c.Description) > 2000 || !utf8.ValidString(c.Description) ||
		c.Score < 0 || c.Score > 1000 || c.Priority < 0 || c.Priority > 1000000 ||
		!strings.HasPrefix(c.Path, "/") || len(c.Path) > 8192 || strings.ContainsAny(c.Path, "%?#\\\\") || strings.Contains(c.Path, "//") {
		return entity.CreateRuleResult{}, entity.ErrRuleInvalid
	}
	for _, b := range []byte(c.Path) {
		if b <= 32 || b >= 127 {
			return entity.CreateRuleResult{}, entity.ErrRuleInvalid
		}
	}
	for _, segment := range strings.Split(c.Path, "/") {
		if segment == "." || segment == ".." {
			return entity.CreateRuleResult{}, entity.ErrRuleInvalid
		}
	}
	switch c.Action {
	case "allow", "log", "block":
	default:
		return entity.CreateRuleResult{}, entity.ErrRuleInvalid
	}
	switch c.Severity {
	case "low", "medium", "high", "critical":
	default:
		return entity.CreateRuleResult{}, entity.ErrRuleInvalid
	}
	switch c.Group {
	case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
	default:
		return entity.CreateRuleResult{}, entity.ErrRuleInvalid
	}
	return s.repo.Create(ctx, c)
}

// ─── 6. Cập nhật Rule (Update) ────────────────────────────────────────────────

// Update kiểm tra phiên bản kỳ vọng (ExpectedVersion) cho cơ chế khóa lạc quan (optimistic locking)
// và xác thực lại toàn bộ dữ liệu cập nhật trước khi ghi đè vào DB.
func (s *ruleService) Update(ctx context.Context, c entity.UpdateRuleCommand) (entity.UpdateRuleResult, error) {
	if c.ID < 1 || c.ExpectedVersion < 1 ||
		strings.TrimSpace(c.Name) == "" || len(c.Name) > 120 || !utf8.ValidString(c.Name) || len(c.Description) > 2000 || !utf8.ValidString(c.Description) ||
		c.Score < 0 || c.Score > 1000 || c.Priority < 0 || c.Priority > 1000000 ||
		!strings.HasPrefix(c.Path, "/") || len(c.Path) > 8192 || strings.ContainsAny(c.Path, "%?#\\\\") || strings.Contains(c.Path, "//") {
		return entity.UpdateRuleResult{}, entity.ErrRuleInvalid
	}
	for _, b := range []byte(c.Path) {
		if b <= 32 || b >= 127 {
			return entity.UpdateRuleResult{}, entity.ErrRuleInvalid
		}
	}
	for _, segment := range strings.Split(c.Path, "/") {
		if segment == "." || segment == ".." {
			return entity.UpdateRuleResult{}, entity.ErrRuleInvalid
		}
	}
	switch c.Action {
	case "allow", "log", "block":
	default:
		return entity.UpdateRuleResult{}, entity.ErrRuleInvalid
	}
	switch c.Severity {
	case "low", "medium", "high", "critical":
	default:
		return entity.UpdateRuleResult{}, entity.ErrRuleInvalid
	}
	switch c.Group {
	case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
	default:
		return entity.UpdateRuleResult{}, entity.ErrRuleInvalid
	}
	return s.repo.Update(ctx, c)
}

// ─── 7. Phát hành Rules (Publish) ─────────────────────────────────────────────

// Publish thực hiện quy trình đóng gói và biên dịch các rule đang bật:
//   1. Khóa gate (chỉ 1 tiến trình biên dịch chạy cùng lúc)
//   2. Reserve: lưu snapshot các rule vào bản ghi release mới
//   3. Gọi binary compiler (aurora-compile) để kiểm định payload cấu hình
//   4. Tính mã băm SHA-256 (digest) và đánh dấu release hoàn tất (ready)
func (s *ruleService) Publish(ctx context.Context, c entity.PublishRulesCommand) (entity.PublishRulesResult, error) {
	var out entity.PublishRulesResult
	if len(c.RequestKey) < 16 || len(c.RequestKey) > 128 {
		return out, entity.ErrRuleInvalid
	}
	if s.compiler == "" {
		return out, entity.ErrPublishUnavailable
	}
	// Khống chế xử lý đồng thời: từ chối nếu có một lượt publish khác đang thực thi
	if !s.gate.TryLock() {
		return out, entity.ErrRuleConflict
	}
	defer s.gate.Unlock()
	source, err := s.repo.Reserve(ctx, c)
	if err != nil {
		return out, err
	}
	out = entity.PublishRulesResult{ID: source.ID, State: source.State, Digest: source.Digest}
	if source.State == "ready" {
		return out, nil
	}
	compileCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(compileCtx, s.compiler)
	cmd.Stdin = bytes.NewReader(source.Payload)
	output := &publishCompilerOutput{}
	cmd.Stdout = output
	if err = cmd.Run(); err != nil {
		return out, entity.ErrPublishUnavailable
	}
	if !bytes.Equal(source.Payload, output.Bytes()) {
		return out, entity.ErrPublishUnavailable
	}
	sum := sha256.Sum256(source.Payload)
	out.Digest = hex.EncodeToString(sum[:])
	if err = s.repo.Complete(ctx, source.ID, out.Digest); err != nil {
		return out, err
	}
	out.State = "ready"
	return out, nil
}

// publishCompilerOutput giới hạn bộ nhớ buffer tối đa 64KB khi compiler xuất dữ liệu.
type publishCompilerOutput struct{ buffer bytes.Buffer }

func (b *publishCompilerOutput) Bytes() []byte { return b.buffer.Bytes() }
func (b *publishCompilerOutput) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 65536 {
		return 0, entity.ErrPublishUnavailable
	}
	return b.buffer.Write(p)
}

// ─── 8. Chi tiết Release (Release) ────────────────────────────────────────────

// Release xem trạng thái và thông tin của một bản phát hành cụ thể.
func (s *ruleService) Release(ctx context.Context, q entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error) {
	if q.ID < 1 {
		return entity.ReleaseDetailResult{}, entity.ErrRuleInvalid
	}
	return s.repo.Release(ctx, q)
}
