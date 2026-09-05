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
	repo     repo.RuleRepository // Interface port kết nối tới tầng lưu trữ cơ sở dữ liệu
	compiler string              // Đường dẫn tệp thực thi biên dịch (binary compiler: aurora-compile)
	gate     sync.Mutex          // Khóa tuần tự hóa: chỉ cho phép đúng 1 tiến trình publish chạy tại một thời điểm
}

// NewRuleService là constructor duy nhất để khởi tạo RuleService.
func NewRuleService(r repo.RuleRepository, compiler string) port.RuleService {
	return &ruleService{
		repo:     r,
		compiler: compiler,
	}
}

// ─── 1. Danh sách Rules (List) ────────────────────────────────────────────────

// List thực hiện nghiệp vụ truy vấn danh sách rule theo bộ lọc phân trang từ repository.
func (s *ruleService) List(ctx context.Context, q entity.ListRulesQuery) (entity.ListRulesResult, error) {
	// Chuyển tiếp yêu cầu truy vấn phân trang và lọc dữ liệu xuống tầng repository
	// Tầng repository sẽ chạy câu lệnh SQL CTE để lọc, phân trang và đếm tổng số bản ghi
	return s.repo.List(ctx, q)
}

// ─── 2. Chi tiết Rule (Detail) ────────────────────────────────────────────────

// Detail thực hiện nghiệp vụ lấy thông tin chi tiết đầy đủ của một rule từ repository.
func (s *ruleService) Detail(ctx context.Context, q entity.RuleDetailQuery) (entity.RuleDetailResult, error) {
	// Gọi repository để đọc thông tin từ bảng chính (rules) và bảng mở rộng (rule_definitions)
	// Trả về cấu hình hoàn chỉnh của luật kèm các điều kiện lọc và cảnh báo vận hành (nếu có)
	return s.repo.Detail(ctx, q)
}

// ─── 3. Thống kê Rules (Stats) ────────────────────────────────────────────────

// Stats thực hiện nghiệp vụ chụp snapshot số liệu thống kê tại mốc thời gian UTC hiện tại.
func (s *ruleService) Stats(ctx context.Context, q entity.RuleStatsQuery) (entity.RuleStatsResult, error) {
	// Cố định mốc thời gian lập báo cáo tại thời điểm hiện tại (UTC)
	// Mốc này dùng làm căn cứ tính toán số dư hiện hành và đối chiếu mức tăng/giảm với đầu tháng
	q.AsOf = time.Now().UTC()

	// Ủy thác việc tính toán snapshot số liệu thống kê cho câu lệnh SQL CTE trong repository
	return s.repo.Stats(ctx, q)
}

// ─── 4. Lịch sử thay đổi Rule (History) ───────────────────────────────────────

// History thực hiện nghiệp vụ truy xuất các phiên bản quá khứ của rule.
func (s *ruleService) History(ctx context.Context, q entity.RuleHistoryQuery) (entity.RuleHistoryResult, error) {
	// Gọi repository để truy vấn danh sách lịch sử sửa đổi từ bảng rule_revisions (Audit Trail)
	// Dữ liệu được sắp xếp giảm dần từ phiên bản mới nhất lùi về quá khứ theo con trỏ phân trang
	return s.repo.History(ctx, q)
}

// ─── 5. Tạo mới Rule (Create) ─────────────────────────────────────────────────

// Create thực hiện nghiệp vụ tạo rule và ghi nhận bản ghi revision ban đầu trong repository.
func (s *ruleService) Create(ctx context.Context, c entity.CreateRuleCommand) (entity.CreateRuleResult, error) {
	// Ủy thác cho repository thực hiện transaction nguyên tử:
	// - Kiểm tra chống gửi trùng lặp (Idempotency) theo RequestKey
	// - Kiểm tra trần giới hạn tối đa 1024 luật
	// - Lưu vào bảng rules và ghi nhận bản ghi lịch sử đầu tiên (version 1) trong rule_revisions
	return s.repo.Create(ctx, c)
}

// ─── 6. Cập nhật Rule (Update) ────────────────────────────────────────────────

// Update thực hiện nghiệp vụ cập nhật rule với cơ chế khóa lạc quan (optimistic locking) tại repository.
func (s *ruleService) Update(ctx context.Context, c entity.UpdateRuleCommand) (entity.UpdateRuleResult, error) {
	// Ủy thác việc cập nhật cho repository:
	// - Kiểm tra không cho phép dùng cập nhật v1 để xóa cấu hình đa điều kiện v2
	// - Áp dụng khóa lạc quan dựa trên ExpectedVersion để phát hiện và ngăn chặn xung đột ghi đè
	// - Tăng version lên 1 đơn vị và ghi bản ghi mới vào bảng lịch sử rule_revisions
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

	// Bước 1: Kiểm tra cấu hình đường dẫn tới trình biên dịch (Compiler binary)
	// Nếu chưa cấu hình binary compiler, từ chối phát hành vì không thể tạo file cấu hình cho WAF
	if s.compiler == "" {
		return out, taxonomy.ErrPublishUnavailable
	}

	// Bước 2: Kiểm soát đồng thời bằng Mutex Gate
	// Chỉ cho phép duy nhất một tiến trình phát hành được chạy tại một thời điểm
	// Nếu có yêu cầu phát hành khác đang diễn ra, từ chối ngay với mã lỗi xung đột (ErrRuleConflict)
	if !s.gate.TryLock() {
		return out, taxonomy.ErrRuleConflict
	}
	defer s.gate.Unlock() // Đảm bảo mở khóa khi quy trình phát hành kết thúc

	// Bước 3: Đặt trước đợt phát hành (Reserve) trong CSDL
	// - Kiểm tra các luật đang bật có đạt chuẩn vận hành (runtime_ready) không
	// - Tạo bản ghi release ở trạng thái 'pending' và đóng băng danh sách các luật đang bật
	// - Đóng gói danh sách luật thành chuỗi JSON Payload nhị phân
	source, err := s.repo.Reserve(ctx, c)
	if err != nil {
		return out, err
	}

	// Sao chép thông tin ban đầu của đợt phát hành sang kết quả trả về
	out = entity.PublishRulesResult{ID: source.ID, State: source.State, Digest: source.Digest}

	// Bước 4: Kiểm tra tính bất biến (Idempotency)
	// Nếu đợt phát hành với RequestKey này đã hoàn tất trước đó ('ready'), trả về ngay lập tức
	if source.State == "ready" {
		return out, nil
	}

	// Bước 5: Thiết lập giới hạn thời gian chạy cho tiến trình biên dịch (Timeout 3 giây)
	// Ngăn chặn tiến trình con bị treo vĩnh viễn làm cạn kiệt tài nguyên hệ thống
	compileCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	// Bước 6: Khởi tạo tiến trình con (Subprocess) chạy binary compiler
	// Truyền toàn bộ gói JSON Payload qua đường dẫn dữ liệu chuẩn (Stdin)
	cmd := exec.CommandContext(compileCtx, s.compiler)
	cmd.Stdin = bytes.NewReader(source.Payload)

	// Hứng kết quả đầu ra của compiler qua buffer có giới hạn dung lượng tối đa 64KB
	output := &publishCompilerOutput{}
	cmd.Stdout = output

	// Bước 7: Thực thi trình biên dịch
	// Nếu compiler trả về mã lỗi khác 0 hoặc bị timeout, báo lỗi hệ thống biên dịch không sẵn sàng
	if err = cmd.Run(); err != nil {
		return out, taxonomy.ErrPublishUnavailable
	}

	// Bước 8: Kiểm tra tính toàn vẹn của kết quả biên dịch
	// Dữ liệu đầu ra từ compiler phải khớp chính xác với payload gốc đã đưa vào
	if !bytes.Equal(source.Payload, output.Bytes()) {
		return out, taxonomy.ErrPublishUnavailable
	}

	// Bước 9: Tính mã băm SHA-256 từ nội dung payload để làm chữ ký niêm phong gói phát hành (Digest)
	sum := sha256.Sum256(source.Payload)
	out.Digest = hex.EncodeToString(sum[:])

	// Bước 10: Chốt hoàn tất đợt phát hành trong CSDL (Complete)
	// Cập nhật mã băm Digest và chuyển trạng thái đợt phát hành từ 'pending' sang 'ready'
	if err = s.repo.Complete(ctx, source.ID, out.Digest); err != nil {
		return out, err
	}

	out.State = "ready"
	return out, nil
}

// publishCompilerOutput giới hạn kích thước buffer tối đa 64KB khi nhận dữ liệu từ compiler.
type publishCompilerOutput struct {
	buffer bytes.Buffer // Bộ nhớ đệm lưu kết quả đầu ra từ tiến trình con
}

// Bytes trả về mảng byte dữ liệu đã thu thập trong buffer.
func (b *publishCompilerOutput) Bytes() []byte {
	return b.buffer.Bytes()
}

// Write ghi dữ liệu vào buffer và kiểm soát trần dung lượng không vượt quá 64KB (65536 bytes)
// nhằm phòng ngừa trường hợp tiến trình con xuất lượng dữ liệu quá lớn gây tràn bộ nhớ.
func (b *publishCompilerOutput) Write(p []byte) (int, error) {
	if b.buffer.Len()+len(p) > 65536 {
		return 0, taxonomy.ErrPublishUnavailable
	}
	return b.buffer.Write(p)
}

// ─── 8. Chi tiết Release (Release) ────────────────────────────────────────────

// Release thực hiện nghiệp vụ truy vấn thông tin trạng thái của bản phát hành.
func (s *ruleService) Release(ctx context.Context, q entity.ReleaseDetailQuery) (entity.ReleaseDetailResult, error) {
	// Gọi repository để tra cứu thông tin đợt phát hành từ bảng ruleset_releases
	// kết hợp với bảng node_activation để lấy giai đoạn kích hoạt trên các node biên WAF
	return s.repo.Release(ctx, q)
}

// ─── 9. Tạo Rule Definition v2 (CreateDefinition) ─────────────────────────────

// CreateDefinition thực hiện phân tích nghiệp vụ tính tương thích runtime (Runtime Compatibility Evaluation)
// và điều phối lưu trữ bản ghi rule definition nâng cao:
//   - Đánh giá xem tập điều kiện đã chuẩn hóa có tương thích với exact-path runtime engine hiện tại không.
//   - Trích xuất canonical path và các cảnh báo (issues).
//   - Lưu nguyên tử rule, revision và definition vào database qua repository.
func (s *ruleService) CreateDefinition(ctx context.Context, c entity.CreateRuleDefinitionCommand) (entity.CreateRuleDefinitionResult, error) {
	issues := []string{} // Danh sách chứa các lý do/cảnh báo nếu luật chưa tương thích với runtime hiện tại
	path := ""           // Đường dẫn chuẩn hóa (Canonical Path) nếu luật tương thích với bộ engine so khớp đường dẫn tĩnh

	// Bước 1: Đánh giá tính tương thích với engine so khớp đường dẫn chính xác (Exact-path Engine)
	// Engine hiện tại yêu cầu luật phải có đúng 1 điều kiện kiểm tra trường 'path' với toán tử 'equals'
	if len(c.Conditions) != 1 || c.Conditions[0].Field != "path" || c.Conditions[0].Operator != "equals" {
		issues = append(issues, "Runtime currently requires one Request Path / Equals condition")
	} else {
		// Trích xuất giá trị đường dẫn và kiểm tra xem có đạt chuẩn Canonical Path hay không:
		// - Phải bắt đầu bằng dấu '/'
		// - Không chứa ký tự đặc biệt / escape: %, ?, #, \
		// - Không chứa hai dấu gạch chéo liên tiếp '//'
		path = c.Conditions[0].Value
		canonical := strings.HasPrefix(path, "/") && !strings.ContainsAny(path, "%?#\\") && !strings.Contains(path, "//")

		// Kiểm tra ký tự in được trong bảng mã ASCII (mã từ 33 đến 126)
		for _, b := range []byte(path) {
			if b <= 32 || b >= 127 {
				canonical = false
			}
		}

		// Kiểm tra không chứa các đoạn dẫn tương đối nguy hiểm như '.' hoặc '..'
		for _, segment := range strings.Split(path, "/") {
			if segment == "." || segment == ".." {
				canonical = false
			}
		}

		// Nếu không đạt chuẩn canonical, ghi nhận cảnh báo và xóa bỏ biến path
		if !canonical {
			issues = append(issues, "Runtime requires a canonical ASCII path without escapes or dot segments")
			path = ""
		}
	}

	// Bước 2: Kiểm tra các bộ lọc phạm vi nâng cao (IP nguồn, Host Domain, Path Prefix, HTTP Method)
	// Hiện tại runtime chưa hỗ trợ các bộ lọc này nên ghi nhận vào danh sách issues
	if c.SourceIP != "" || c.HostDomain != "" || c.PathPrefix != "" || c.HTTPMethod != "" {
		issues = append(issues, "Runtime scope filtering is not implemented")
	}

	// Bước 3: Kiểm tra cấu hình phản hồi tùy biến khi Chặn (Block)
	// Runtime hiện tại chỉ hỗ trợ mã phản hồi mặc định là 403 Forbidden không kèm thân tùy biến
	if c.Action == "block" && (*c.ResponseCode != 403 || c.CustomResponse != "") {
		issues = append(issues, "Runtime supports only the default 403 response body")
	}

	// Bước 4: Kiểm tra tính năng ghi log sự kiện riêng cho từng luật
	// Nếu bật cờ LogEvent, ghi nhận cảnh báo do runtime chưa hỗ trợ phân luồng log riêng
	if c.LogEvent {
		issues = append(issues, "Per-rule security event collection is not implemented")
	}

	// Bước 5: Kiểm tra tính năng cập nhật điểm danh tiếng địa chỉ IP (IP Reputation)
	// Hiện runtime chưa hỗ trợ tự động thay đổi điểm uy tín IP khi vi phạm
	if c.AddToReputation {
		issues = append(issues, "IP reputation mutations are not implemented")
	}

	// Bước 6: Ủy thác lưu trữ cho tầng repository trong một transaction an toàn:
	// - Kiểm tra tính bất biến Idempotency theo RequestKey
	// - Kiểm tra giới hạn 1024 luật của toàn hệ thống
	// - Ghi đồng thời vào các bảng: rules, rule_revisions, rule_definitions, definition_creates
	// - Tự động đánh dấu RuntimeReady = (len(issues) == 0)
	return s.repo.CreateDefinition(ctx, c, issues, path)
}
