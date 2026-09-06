package entity

import (
	"time"
)

// ─── 1. Workflow: Publish Rules (Đóng gói & Phát hành đợt luật mới) ───────────

// PublishRulesSource chứa dữ liệu trung gian giữa Repository và Service trong workflow phát hành.
// Hàm Repository Reserve() đóng gói danh sách luật đang bật và trả về struct này;
// Service dùng Payload để chuyển sang máy biên dịch (Compiler) rồi gọi Complete() để chốt phát hành.
type PublishRulesSource struct {
	ID      int64  // Mã định danh của đợt phát hành (Release ID)
	Payload []byte // Dữ liệu nhị phân chứa danh sách luật JSON nén dưới 64KB gửi cho máy biên dịch
	State   string // Trạng thái phát hành ('pending' hoặc 'ready')
	Digest  string // Mã băm SHA-256 kiểm tra tính toàn vẹn của gói phát hành
}

// PublishRulesCommand là lệnh kích hoạt quy trình phát hành bộ luật gửi từ Handler vào Service.
type PublishRulesCommand struct {
	RequestKey string // Khóa Idempotency dùng để chống gửi lặp lại lệnh phát hành
}

// PublishRulesResult chứa kết quả trả về sau khi hoàn tất đóng gói và phát hành thành công.
type PublishRulesResult struct {
	ID     int64  // Mã định danh của bản phát hành vừa tạo
	State  string // Trạng thái sau khi hoàn tất (thường là 'ready')
	Digest string // Mã băm toàn vẹn SHA-256 của bản phát hành
}

// ─── 2. Workflow: Release Detail (Xem chi tiết bản phát hành & node biên) ──────

// ReleaseDetailQuery chứa tham số tra cứu thông tin chi tiết của một đợt phát hành.
type ReleaseDetailQuery struct {
	ID int64 // Mã định danh của bản phát hành cần tra cứu
}

// ReleaseDetailResult chứa thông tin chi tiết và tiến độ triển khai của bản phát hành trên các node WAF.
type ReleaseDetailResult struct {
	ID              int64   // Mã định danh bản phát hành
	State           string  // Trạng thái của bản phát hành ('pending', 'ready')
	Digest          string  // Mã băm toàn vẹn SHA-256
	CreatedAt       string  // Thời điểm tạo bản phát hành
	ActivationPhase *string // Giai đoạn kích hoạt trên node biên (ví dụ: 'active', 'reloading'...), có thể là nil nếu chưa kích hoạt
}

// ─── 3. Workflow: Rule History (Lịch sử các phiên bản sửa đổi - Audit Trail) ───

// RuleHistoryQuery chứa các tham số tra cứu danh sách lịch sử sửa đổi của một luật.
type RuleHistoryQuery struct {
	ID     int64 // Mã định danh của luật cần xem lịch sử
	Before int64 // Con trỏ phiên bản mốc (chỉ lấy các bản ghi có version nhỏ hơn 'Before')
	Limit  int   // Số lượng bản ghi tối đa cần lấy trên mỗi trang
}

// RuleHistoryRecord biểu diễn một bản ghi lịch sử thay đổi của luật tại một phiên bản cụ thể.
type RuleHistoryRecord struct {
	Version        int64  // Số thứ tự phiên bản sửa đổi
	Name           string // Tên của luật tại thời điểm phiên bản này được lưu
	Description    string // Mô tả chi tiết của luật
	Group          string // Phân loại nhóm luật
	Action         string // Hành vi xử lý của luật tại phiên bản này ('allow', 'log', 'block')
	Severity       string // Mức độ nghiêm trọng: low, medium, high, critical
	Priority       int    // Độ ưu tiên thực thi
	Path           string // Đường dẫn URL quy định
	Enabled        bool   // Trạng thái bật hoặc tắt của luật tại phiên bản này
	Actor          string // Định danh người hoặc token đã thực hiện thay đổi
	UpdatedAt      string // Thời điểm bản ghi được cập nhật
	LogicMode      string // Logic kết hợp điều kiện: 'all' hoặc 'any'
	ConditionsJSON string // Danh sách điều kiện dạng chuỗi JSON
	ResponseCode   int    // Mã HTTP phản hồi khi chặn
	CustomResponse string // Nội dung phản hồi tùy biến
}

// RuleHistoryResult chứa danh sách kết quả lịch sử phiên bản trả về cho client.
type RuleHistoryResult struct {
	Items      []RuleHistoryRecord // Danh sách các phiên bản lịch sử sắp xếp từ mới nhất về cũ nhất
	NextBefore int64               // Mốc con trỏ phiên bản cho trang kế tiếp (bằng 0 nếu đã hết dữ liệu)
}

// RollbackRuleCommand là lệnh yêu cầu khôi phục cấu hình của một rule về phiên bản cũ.
type RollbackRuleCommand struct {
	ID            int64  // ID của luật cần rollback
	TargetVersion int64  // Phiên bản muốn khôi phục
	Actor         string // Người hoặc token thực hiện thao tác
}

// RollbackRuleResult chứa kết quả sau khi thực hiện khôi phục phiên bản.
type RollbackRuleResult struct {
	ID      int64  // ID của luật
	Version int64  // Phiên bản mới được sinh ra sau khi rollback
	Name    string // Tên luật
	Action  string // Hành động
	Enabled bool   // Trạng thái kích hoạt
}

// ─── 4. Workflow: Create Rule (Tạo mới luật bảo vệ cơ bản v1) ─────────────────

// CreateRuleCommand là lệnh gửi từ Handler vào Service để tạo mới một luật theo đường dẫn tĩnh (Schema v1).
type CreateRuleCommand struct {
	RequestKey  string // Khóa Idempotency chống gửi trùng lặp yêu cầu tạo luật
	Name        string // Tên luật bảo vệ (tối đa 120 ký tự UTF-8)
	Description string // Mô tả mục đích bảo vệ của luật (tối đa 2000 ký tự)
	Group       string // Nhóm phân loại quy tắc (custom, sqli, xss, bot, traversal, endpoint, authentication)
	Action      string // Hành vi xử lý khi phát hiện vi phạm: 'allow' (cho qua), 'log' (ghi vết), 'block' (chặn)
	Severity    string // Mức độ nghiêm trọng của rủi ro: 'low', 'medium', 'high', 'critical'
	Score       int    // Điểm cảnh báo rủi ro (từ 0 đến 1000)
	Priority    int    // Thứ tự ưu tiên thực thi (từ 0 đến 1.000.000, số càng nhỏ ưu tiên chạy trước)
	Path        string // Đường dẫn URL tĩnh cần kiểm tra (bắt đầu bằng '/', tối đa 8192 ký tự)
	Enabled     bool   // Trạng thái kích hoạt luật (true: bật, false: tắt)
}

// CreateRuleResult chứa kết quả trả về sau khi tạo luật cơ bản thành công.
type CreateRuleResult struct {
	ID      int64 // Mã số định danh duy nhất vừa được cấp cho luật mới
	Version int64 // Số phiên bản khởi tạo ban đầu (mặc định là 1)
}

// ─── 5. Workflow: Update Rule (Chỉnh sửa luật hiện có - Khóa lạc quan) ─────────

// UpdateRuleCommand là lệnh cập nhật toàn bộ thông tin của một luật WAF đang tồn tại.
type UpdateRuleCommand struct {
	ID              int64  // Mã định danh của luật cần chỉnh sửa
	ExpectedVersion int64  // Phiên bản kỳ vọng hiện tại (Optimistic Lock) để chống ghi đè mất dữ liệu khi có sửa đổi đồng thời
	Name            string // Tên luật mới
	Description     string // Mô tả mới
	Group           string // Nhóm phân loại mới
	Action          string // Hành vi xử lý mới ('allow', 'log', 'block')
	Severity        string // Mức độ nghiêm trọng mới
	Score           int    // Điểm cảnh báo rủi ro mới
	Priority        int    // Thứ tự ưu tiên mới
	Path            string // Đường dẫn URL mới
	Enabled         bool   // Trạng thái bật/tắt mới
}

// UpdateRuleResult chứa kết quả trả về sau khi cập nhật thành công.
type UpdateRuleResult struct {
	ID      int64 // Mã định danh của luật vừa được cập nhật
	Version int64 // Số phiên bản mới sau khi tăng (Version hiện tại + 1)
}

// ─── 6. Workflow: List Rules (Tra cứu danh mục luật & Phân trang) ─────────────

// ListRulesQuery chứa các tiêu chí tìm kiếm, bộ lọc và tham số phân trang danh sách luật.
type ListRulesQuery struct {
	Limit    int    // Số lượng luật tối đa cần lấy trên mỗi trang (mặc định 50, tối đa 100)
	After    int64  // Mốc ID con trỏ phân trang (chỉ lấy các luật có ID lớn hơn 'After')
	Search   string // Từ khóa tìm kiếm theo tên luật
	Group    string // Bộ lọc theo nhóm phân loại quy tắc (để trống nếu lấy tất cả)
	Action   string // Bộ lọc theo hành vi xử lý ('allow', 'log', 'block')
	Severity string // Bộ lọc theo mức độ nghiêm trọng ('low', 'medium', 'high', 'critical')
	Enabled  string // Bộ lọc theo trạng thái hoạt động ('true' hoặc 'false', để trống nếu lấy cả hai)
}

// ListRulesItem biểu diễn thông tin tóm tắt của một luật trong danh sách kết quả tra cứu.
type ListRulesItem struct {
	SchemaVersion int    // Phiên bản schema của luật (1: luật cơ bản theo đường dẫn, 2: luật nâng cao đa điều kiện)
	RuntimeReady  bool   // Trạng thái sẵn sàng chạy trên node biên (true: sẵn sàng, false: có cảnh báo/lỗi)
	ID            int64  // Mã định danh duy nhất của luật
	Version       int64  // Phiên bản hiện tại của luật
	Name          string // Tên luật
	Description   string // Mô tả ngắn
	Group         string // Nhóm phân loại
	Action        string // Hành vi xử lý ('allow', 'log', 'block')
	Severity      string // Mức độ nghiêm trọng
	Score         int    // Điểm cảnh báo rủi ro
	Priority      int    // Thứ tự ưu tiên thực thi
	Path          string // Đường dẫn URL áp dụng
	Enabled       bool   // Trạng thái bật hoặc tắt
	UpdatedAt     string // Thời điểm cập nhật gần nhất (chuỗi thời gian)
}

// ListRulesResult chứa kết quả danh sách luật sau khi lọc và phân trang.
type ListRulesResult struct {
	Total     int             // Tổng số lượng luật thỏa mãn bộ lọc trong toàn bộ CSDL
	Items     []ListRulesItem // Danh sách các luật thuộc trang hiện tại
	NextAfter string          // Chuỗi ID con trỏ cho trang kế tiếp (để trống nếu đã là trang cuối)
}

// ─── 7. Workflow: Rule Detail (Xem hồ sơ chi tiết của một luật) ───────────────

// RuleDetailQuery chứa tham số yêu cầu tra cứu chi tiết một luật cụ thể.
type RuleDetailQuery struct {
	ID int64 // Mã định danh của luật cần xem chi tiết
}

// RuleDetailCondition biểu diễn một điều kiện lọc cụ thể trong hồ sơ chi tiết của luật.
type RuleDetailCondition struct {
	Field      string // Trường thông tin cần soi chiếu (uri_raw, path, query, header, body, client_ip, method)
	Operator   string // Phép so sánh (equals, contains, starts_with, ends_with, regex, cidr)
	Value      string // Giá trị cần so khớp
	HeaderName string // Tên tiêu đề HTTP (chỉ có giá trị khi Field là 'header')
}

// RuleDetailResult chứa toàn bộ thông tin chi tiết và cấu hình vận hành của một luật bảo vệ.
type RuleDetailResult struct {
	SchemaVersion   int                   // Phiên bản schema (1: luật cơ bản v1, 2: luật nâng cao v2)
	RuntimeReady    bool                  // Luật đã đủ tiêu chuẩn để nạp vào bộ máy WAF biên chưa
	RuntimeIssues   []string              // Danh sách các vấn đề/cảnh báo vận hành nếu có (ví dụ biểu thức regex chưa tối ưu)
	LogicMode       string                // Chế độ kết hợp điều kiện ('all': thỏa mãn tất cả, 'any': thỏa mãn một trong số)
	Conditions      []RuleDetailCondition // Danh sách các điều kiện kiểm tra chi tiết
	SourceIP        string                // Danh sách IP hoặc dải mạng CIDR nguồn áp dụng luật
	HostDomain      string                // Tên miền máy chủ áp dụng luật
	PathPrefix      string                // Tiền tố đường dẫn áp dụng luật
	HTTPMethod      string                // Phương thức HTTP áp dụng (GET, POST, PUT, DELETE...)
	ResponseCode    *int                  // Mã phản hồi HTTP khi bị chặn (400, 403, 429, 500), nil nếu không phải hành vi block
	CustomResponse  string                // Nội dung phản hồi tùy biến trả về cho người dùng khi bị chặn
	LogEvent        bool                  // Có ghi sự kiện vào log bảo mật khi khớp luật hay không
	AddToReputation bool                  // Có tính điểm vi phạm vào danh tiếng IP hay không
	ID              int64                 // Mã định danh của luật
	Version         int64                 // Phiên bản hiện tại
	Name            string                // Tên luật
	Description     string                // Mô tả luật
	Group           string                // Nhóm quy tắc
	Action          string                // Hành vi ('allow', 'log', 'block')
	Severity        string                // Mức độ nghiêm trọng
	Score           int                   // Điểm rủi ro
	Priority        int                   // Độ ưu tiên
	Path            string                // Đường dẫn URL
	Enabled         bool                  // Trạng thái bật/tắt
	UpdatedAt       string                // Thời điểm cập nhật gần nhất
}

// ─── 8. Workflow: Rule Stats (Thống kê & Đo lường tổng quan số lượng luật) ─────

// RuleStatsQuery chứa tham số mốc thời gian để tính toán số liệu thống kê.
type RuleStatsQuery struct {
	AsOf time.Time // Thời điểm cần lập báo cáo thống kê
}

// RuleStatsResult chứa kết quả đo lường số lượng luật hiện tại và mức độ tăng/giảm so với đầu tháng.
type RuleStatsResult struct {
	AsOf             string // Chuỗi thời gian lập báo cáo định dạng RFC3339
	ComparisonBefore string // Mốc thời điểm ngày đầu tháng (00:00:00 UTC) dùng để so sánh
	HistoryAvailable bool   // Hệ thống đã có đủ dữ liệu lịch sử di trú trước mốc so sánh hay chưa
	TotalDelta       *int   // Mức chênh lệch tổng số luật so với đầu tháng (nil nếu chưa có lịch sử)
	EnabledDelta     *int   // Mức chênh lệch số luật đang Bật so với đầu tháng
	LogDelta         *int   // Mức chênh lệch số luật ở chế độ Ghi log so với đầu tháng
	BlockDelta       *int   // Mức chênh lệch số luật ở chế độ Chặn so với đầu tháng
	Total            int    // Tổng số luật đang có trong hệ thống ở thời điểm hiện tại
	Enabled          int    // Số lượng luật đang ở trạng thái Bật
	Log              int    // Số lượng luật đang ở chế độ Ghi log
	Block            int    // Số lượng luật đang ở chế độ Chặn
}

// ─── 9. Workflow: Create Rule Definition (Tạo luật nâng cao đa điều kiện v2) ───

// CreateRuleCondition biểu diễn một điều kiện kiểm tra cụ thể khi tạo luật thế hệ 2.
type CreateRuleCondition struct {
	Field      string // Trường thông tin gói tin cần kiểm tra (uri_raw, path, query, header, body, client_ip, method)
	Operator   string // Toán tử so khớp (equals, contains, starts_with, ends_with, regex, cidr)
	Value      string // Giá trị kiểm tra (tối đa 8192 bytes, regex tối đa 1024 bytes)
	HeaderName string // Tên tiêu đề HTTP (chỉ dùng khi Field là 'header', tối đa 128 bytes)
}

// CreateRuleDefinitionCommand là lệnh gửi từ Handler vào Service để tạo mới luật đa điều kiện v2.
type CreateRuleDefinitionCommand struct {
	RequestKey      string                // Khóa Idempotency chống gửi lặp lại yêu cầu
	Name            string                // Tên luật (tối đa 120 ký tự UTF-8)
	Description     string                // Mô tả chi tiết (tối đa 2000 ký tự UTF-8)
	Group           string                // Nhóm danh mục quy tắc (custom, sqli, xss, bot, traversal...)
	Severity        string                // Mức độ nghiêm trọng (low, medium, high, critical)
	Score           int                   // Điểm rủi ro (0 đến 1000)
	Enabled         bool                  // Trạng thái bật/tắt luật
	Priority        int                   // Độ ưu tiên thực thi (0 đến 1.000.000)
	PolicyID        *string               // ID chính sách bảo mật liên kết (tùy chọn)
	LogicMode       string                // Chế độ kết hợp điều kiện ('all' hoặc 'any')
	Conditions      []CreateRuleCondition // Danh sách từ 1 đến 16 điều kiện kiểm tra
	Action          string                // Hành vi xử lý: 'allow', 'log', 'block'
	ResponseCode    *int                  // Mã phản hồi HTTP khi Chặn (400, 403, 429, 500), bắt buộc với action 'block'
	CustomResponse  string                // Thân phản hồi tùy biến khi Chặn (tối đa 512 ký tự)
	LogEvent        bool                  // Ghi log sự kiện bảo mật khi khớp luật
	AddToReputation bool                  // Đánh dấu giảm uy tín địa chỉ IP khi vi phạm
	SourceIP        string                // Danh sách IP/CIDR nguồn áp dụng (tối đa 32 địa chỉ, cách nhau dấu phẩy)
	HostDomain      string                // Tên miền máy chủ áp dụng (tối đa 253 ký tự ASCII)
	PathPrefix      string                // Tiền tố đường dẫn áp dụng (bắt đầu bằng '/', tối đa 8192 ký tự)
	HTTPMethod      string                // Phương thức HTTP áp dụng (GET, POST, PUT, DELETE...)
}

// CreateRuleDefinitionResult chứa kết quả trả về sau khi lưu trữ luật đa điều kiện thành công.
type CreateRuleDefinitionResult struct {
	ID            int64    // Mã định danh duy nhất vừa cấp cho luật mới
	Version       int64    // Phiên bản khởi tạo ban đầu (mặc định = 1)
	State         string   // Trạng thái lưu trữ (ví dụ: 'saved')
	RuntimeReady  bool     // Trạng thái sẵn sàng vận hành của luật
	RuntimeIssues []string // Danh sách các cảnh báo vận hành phát hiện trong quá trình tạo (nếu có)
}

// ─── 10. Workflow: Test Rule (Kiểm thử và đánh giá luật qua sample request) ────

// TestConditionDetail chứa kết quả so khớp chi tiết của từng điều kiện đơn lẻ.
type TestConditionDetail struct {
	Field          string // Tên trường (uri_raw, path, query, header, body, client_ip, method)
	Operator       string // Toán tử (equals, contains, starts_with, ends_with, regex, cidr)
	Value          string // Pattern so sánh
	HeaderName     string // Tên header (nếu field là header)
	ExtractedValue string // Giá trị trích xuất được từ request
	Matched        bool   // Điều kiện này có khớp hay không
}

// TestRuleCommand là lệnh yêu cầu kiểm thử đánh giá request với tập điều kiện.
type TestRuleCommand struct {
	RuleID       *int64                // ID của rule đã lưu (nếu kiểm thử rule có sẵn trong DB)
	Method       string                // HTTP Method: GET, POST, PUT, DELETE...
	URL          string                // Request URL hoặc URI cần kiểm tra
	Headers      map[string]string     // Các HTTP Header giả lập
	Body         string                // Thân request (nếu có)
	ClientIP     string                // Địa chỉ IP client (nếu có)
	Conditions   []RuleDetailCondition // Tập điều kiện kiểm thử trực tiếp (nếu test nháp)
	LogicMode    string                // 'all' hoặc 'any'
	Action       string                // 'block', 'allow', 'log'
	ResponseCode int                   // Mã phản hồi khi block (mặc định 403)
}

// TestRuleResult chứa kết quả đánh giá chi tiết sau khi chạy qua bộ kiểm tra rule.
type TestRuleResult struct {
	Matched          bool                  // Request có bị kích hoạt bởi rule hay không
	Action           string                // Hành động tương ứng ('block', 'allow', 'log')
	ResponseCode     int                   // Mã HTTP phản hồi (ví dụ 403, 200)
	ActionDispatched string                // Chuỗi mô tả hành động (ví dụ "HTTP 403 response", "HTTP 200 Pass Through")
	LatencyMS        float64               // Độ trễ tính toán theo milliseconds (ms)
	EvaluationTimeNs int64                 // Thời gian tính toán theo nanoseconds (ns)
	MatchedField     string                // Tên trường kích hoạt vi phạm
	MatchedPattern   string                // Pattern/Regex kích hoạt vi phạm
	MatchedValue     string                // Chuỗi giá trị thực tế vi phạm
	Explanation      string                // Giải thích ngắn gọn lý do kích hoạt hoặc bỏ qua
	Details          []TestConditionDetail // Chi tiết từng điều kiện trong tập rule
}

