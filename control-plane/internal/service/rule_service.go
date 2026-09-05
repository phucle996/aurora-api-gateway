package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// ruleService là struct duy nhất tập trung xử lý toàn bộ logic nghiệp vụ (business logic)
// của đối tượng Rule và Release:
//   - Tầng service không lặp lại việc kiểm tra khuôn dạng dữ liệu thô (chuỗi, độ dài, UTF-8, regex)
//     vì việc đó đã được tầng handler giải quyết và làm sạch (sanitize).
//   - Tầng service chịu trách nhiệm về các quy tắc nghiệp vụ: đánh giá tính tương thích runtime,
//     điều phối quy trình phát hành (compiler gate, subprocess, digest SHA-256),
//     và ủy thác lưu trữ cho repository.
type ruleService struct {
	repo     repo.RuleRepository
	compiler string     // Đường dẫn binary compiler (aurora-compile)
	gate     sync.Mutex // Concurrency gate: chỉ cho phép 1 tiến trình publish chạy tại 1 thời điểm
}

// NewRuleService là constructor duy nhất để khởi tạo RuleService.
func NewRuleService(r repo.RuleRepository, compiler string) port.RuleService {
	return &ruleService{repo: r, compiler: compiler}
}

// ─── 1. Danh sách Rules (List) ────────────────────────────────────────────────

// List thực hiện nghiệp vụ truy vấn danh sách rule theo bộ lọc phân trang từ repository.
func (s *ruleService) List(ctx context.Context, q entity.ListRulesQuery) (entity.ListRulesResult, error) {
	return s.repo.List(ctx, q)
}

// ─── 2. Chi tiết Rule (Detail) ────────────────────────────────────────────────

// Detail thực hiện nghiệp vụ lấy thông tin chi tiết đầy đủ của một rule từ repository.
func (s *ruleService) Detail(ctx context.Context, q entity.RuleDetailQuery) (entity.RuleDetailResult, error) {
	return s.repo.Detail(ctx, q)
}

// ─── 3. Thống kê Rules (Stats) ────────────────────────────────────────────────

// Stats thực hiện nghiệp vụ chụp snapshot số liệu thống kê tại mốc thời gian UTC hiện tại.
func (s *ruleService) Stats(ctx context.Context, q entity.RuleStatsQuery) (entity.RuleStatsResult, error) {
	q.AsOf = time.Now().UTC()
	return s.repo.Stats(ctx, q)
}

// ─── 4. Lịch sử thay đổi Rule (History) ───────────────────────────────────────

// History thực hiện nghiệp vụ truy xuất các phiên bản quá khứ của rule.
func (s *ruleService) History(ctx context.Context, q entity.RuleHistoryQuery) (entity.RuleHistoryResult, error) {
	return s.repo.History(ctx, q)
}

// ─── 5. Tạo mới Rule (Create) ─────────────────────────────────────────────────

// Create thực hiện nghiệp vụ tạo rule và ghi nhận bản ghi revision ban đầu trong repository.
func (s *ruleService) Create(ctx context.Context, c entity.CreateRuleCommand) (entity.CreateRuleResult, error) {
	return s.repo.Create(ctx, c)
}

// ─── 6. Cập nhật Rule (Update) ────────────────────────────────────────────────

// Update thực hiện nghiệp vụ cập nhật rule với cơ chế khóa lạc quan (optimistic locking) tại repository.
func (s *ruleService) Update(ctx context.Context, c entity.UpdateRuleCommand) (entity.UpdateRuleResult, error) {
	return s.repo.Update(ctx, c)
}

// ─── 7. Phát hành Rules (Publish) ─────────────────────────────────────────────

// Publish điều phối quy trình phát hành bộ rule ra cấu hình NGINX:
//  1. Invariant: Compiler binary phải sẵn sàng.
//  2. Invariant: Mutex gate đảm bảo tính tuần tự, tránh xung đột giữa 2 lượt publish.
//  3. Reserve: Đóng băng trạng thái các rule đang enabled thành bản ghi release.
//  4. Idempotency: Nếu release đã hoàn tất trước đó, trả về ngay.
//  5. Subprocess: Gọi aurora-compile để kiểm định và chuẩn hóa payload.
//  6. Complete: Tính mã băm SHA-256 và chuyển trạng thái release sang "ready".
func (s *ruleService) Publish(ctx context.Context, c entity.PublishRulesCommand) (entity.PublishRulesResult, error) {
	var out entity.PublishRulesResult
	if s.compiler == "" {
		return out, taxonomy.ErrPublishUnavailable
	}
	if !s.gate.TryLock() {
		return out, taxonomy.ErrRuleConflict
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
		return out, taxonomy.ErrPublishUnavailable
	}
	if !bytes.Equal(source.Payload, output.Bytes()) {
		return out, taxonomy.ErrPublishUnavailable
	}

	sum := sha256.Sum256(source.Payload)
	out.Digest = hex.EncodeToString(sum[:])
	if err = s.repo.Complete(ctx, source.ID, out.Digest); err != nil {
		return out, err
	}
	out.State = "ready"
	return out, nil
}

// publishCompilerOutput giới hạn kích thước buffer tối đa 64KB khi nhận dữ liệu từ compiler.
type publishCompilerOutput struct{ buffer bytes.Buffer }

func (b *publishCompilerOutput) Bytes() []byte { return b.buffer.Bytes() }
func (b *publishCompilerOutput) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 65536 {
		return 0, taxonomy.ErrPublishUnavailable
	}
	return b.buffer.Write(p)
}

// ─── 8. Chi tiết Release (Release) ────────────────────────────────────────────

// Release thực hiện nghiệp vụ truy vấn thông tin trạng thái của bản phát hành.
func (s *ruleService) Release(ctx context.Context, q entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error) {
	return s.repo.Release(ctx, q)
}

// ─── 9. Tạo Rule Definition v2 (CreateDefinition) ─────────────────────────────

// CreateDefinition thực hiện phân tích nghiệp vụ tính tương thích runtime (Runtime Compatibility Evaluation)
// và điều phối lưu trữ bản ghi rule definition nâng cao:
//   - Đánh giá xem tập điều kiện đã chuẩn hóa có tương thích với exact-path runtime engine hiện tại không.
//   - Trích xuất canonical path và các cảnh báo (issues).
//   - Lưu nguyên tử rule, revision và definition vào database qua repository.
func (s *ruleService) CreateDefinition(ctx context.Context, c entity.CreateRuleDefinitionCommand) (entity.CreateRuleDefinitionResult, error) {
	issues := []string{}
	path := ""

	// Kiểm tra xem rule có tương thích với engine so khớp path chính xác hiện thời không
	if len(c.Conditions) != 1 || c.Conditions[0].Field != "path" || c.Conditions[0].Operator != "equals" {
		issues = append(issues, "Runtime currently requires one Request Path / Equals condition")
	} else {
		path = c.Conditions[0].Value
		canonical := strings.HasPrefix(path, "/") && !strings.ContainsAny(path, "%?#\\") && !strings.Contains(path, "//")
		for _, b := range []byte(path) {
			if b <= 32 || b >= 127 {
				canonical = false
			}
		}
		for _, segment := range strings.Split(path, "/") {
			if segment == "." || segment == ".." {
				canonical = false
			}
		}
		if !canonical {
			issues = append(issues, "Runtime requires a canonical ASCII path without escapes or dot segments")
			path = ""
		}
	}

	if c.SourceIP != "" || c.HostDomain != "" || c.PathPrefix != "" || c.HTTPMethod != "" {
		issues = append(issues, "Runtime scope filtering is not implemented")
	}
	if c.Action == "block" && (*c.ResponseCode != 403 || c.CustomResponse != "") {
		issues = append(issues, "Runtime supports only the default 403 response body")
	}
	if c.LogEvent {
		issues = append(issues, "Per-rule security event collection is not implemented")
	}
	if c.AddToReputation {
		issues = append(issues, "IP reputation mutations are not implemented")
	}

	return s.repo.CreateDefinition(ctx, c, issues, path)
}
