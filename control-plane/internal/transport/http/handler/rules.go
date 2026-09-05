package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

// ─── 1. Create Rule (POST /api/v1/rules — Đăng ký luật bảo vệ cơ bản) ──────────

// CreateRule tiếp nhận yêu cầu tạo mới một luật bảo vệ WAF thế hệ 1 (theo đường dẫn tĩnh).
//
// [Góc nhìn kinh tế / tiếp nhận hồ sơ]:
// Tương đương quầy tiếp nhận hồ sơ đăng ký chính sách bảo vệ mới:
// - Kiểm tra định dạng đơn nộp: Bắt buộc chuẩn JSON, giới hạn hồ sơ dưới 64KB (chống tấn công làm nghẽn quầy DoS).
// - Kiểm tra mã biên lai chống trùng (Idempotency-Key): Ngăn chặn tình trạng nhân viên ấn nút gửi 2 lần tạo ra 2 luật trùng nhau.
// - Thẩm định tại chỗ (Sanitization & Validation inline): Soát xét tính hợp lệ của tên, nhóm rủi ro, điểm cảnh báo và hành vi trước khi chuyển tiếp vào phòng xử lý nghiệp vụ.
// - Trả về mã số định danh (ID) và số phiên bản khởi tạo (Version = 1) dưới dạng phản hồi inline.
func CreateRule(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Kiểm tra tiêu đề Content-Type — bắt buộc là đơn chuẩn application/json
		if strings.Split(c.GetHeader("Content-Type"), ";")[0] != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}

		// Bước 2: Khống chế dung lượng tối đa 64KB để bảo vệ bộ nhớ máy chủ tiếp nhận
		reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
		d := json.NewDecoder(reader)
		d.DisallowUnknownFields() // Nghiêm cấm gửi thừa trường dữ liệu không nằm trong biểu mẫu

		var req dto.CreateRuleRequest
		if err := d.Decode(&req); err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				c.String(http.StatusRequestEntityTooLarge, "request body exceeds 64KB limit")
				return
			}
			c.String(http.StatusBadRequest, "invalid JSON")
			return
		}

		// Đảm bảo hồ sơ không có dữ liệu lạ bám theo đuôi
		if err := d.Decode(new(any)); err != io.EOF {
			c.String(http.StatusBadRequest, "trailing JSON")
			return
		}

		// Bước 3: Kiểm tra khóa đối soát Idempotency (độ dài hợp lệ từ 16 đến 128 ký tự)
		key := c.GetHeader("Idempotency-Key")
		if len(key) < 16 || len(key) > 128 {
			c.String(http.StatusUnprocessableEntity, "invalid idempotency key")
			return
		}

		// Bước 4: Thẩm định và làm sạch dữ liệu hồ sơ ngay tại quầy tiếp tân (Inline Validation):
		// - Tên luật: Bắt buộc, tối đa 120 ký tự UTF-8, không để khoảng trắng vô nghĩa.
		// - Mô tả: Tối đa 2000 ký tự UTF-8.
		// - Điểm rủi ro (Score): Thang điểm từ 0 đến 1000.
		// - Thứ tự ưu tiên (Priority): Từ 0 đến 1.000.000.
		// - Đường dẫn (Path): Bắt buộc bắt đầu bằng '/', tối đa 8192 ký tự, không chứa ký tự điều khiển hay đường dẫn tương đối (./..).
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" || len(req.Name) > 120 || !utf8.ValidString(req.Name) ||
			len(req.Description) > 2000 || !utf8.ValidString(req.Description) ||
			req.Score < 0 || req.Score > 1000 || req.Priority < 0 || req.Priority > 1000000 ||
			!strings.HasPrefix(req.Path, "/") || len(req.Path) > 8192 || strings.ContainsAny(req.Path, "%?#\\\\") || strings.Contains(req.Path, "//") {
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}
		for _, b := range []byte(req.Path) {
			if b <= 32 || b >= 127 {
				c.String(http.StatusUnprocessableEntity, "invalid rule")
				return
			}
		}
		for _, segment := range strings.Split(req.Path, "/") {
			if segment == "." || segment == ".." {
				c.String(http.StatusUnprocessableEntity, "invalid rule")
				return
			}
		}

		// Kiểm tra hành vi tác động: Chỉ cho phép 'allow' (cho qua), 'log' (ghi nhận theo dõi), 'block' (chặn đứng)
		switch req.Action {
		case "allow", "log", "block":
		default:
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}

		// Kiểm tra phân loại mức độ nghiêm trọng rủi ro
		switch req.Severity {
		case "low", "medium", "high", "critical":
		default:
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}

		// Kiểm tra nhóm danh mục nghiệp vụ bảo vệ
		switch req.Group {
		case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
		default:
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}

		// Bước 5: Đóng gói dữ liệu sạch từ DTO thành lệnh Command phẳng (Flat Entity) gửi vào tầng Service
		cmd := entity.CreateRuleCommand{
			RequestKey:  key,
			Name:        req.Name,
			Description: req.Description,
			Group:       req.Group,
			Action:      req.Action,
			Severity:    req.Severity,
			Score:       req.Score,
			Priority:    req.Priority,
			Path:        req.Path,
			Enabled:     req.Enabled,
		}

		// Bước 6: Gọi dịch vụ nghiệp vụ để ghi nhận vào hệ thống
		out, err := s.Create(c.Request.Context(), cmd)
		if err != nil {
			switch {
			case errors.Is(err, taxonomy.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, taxonomy.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error()) // Trùng lặp khóa yêu cầu nhưng sai khác nội dung
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}

		// Bước 7: Trả về kết quả thành công HTTP 201 Created bằng cấu trúc gin.H inline
		c.JSON(http.StatusCreated, gin.H{
			"id":      strconv.FormatInt(out.ID, 10),
			"version": out.Version,
		})
	}
}

// ─── 2. Update Rule (PUT /api/v1/rules/:id — Điều chỉnh nội dung luật) ─────────

// UpdateRule xử lý cập nhật toàn bộ nội dung của một luật WAF đang tồn tại.
//
// [Góc nhìn kinh tế / quản trị sửa đổi hợp đồng]:
// Tương đương việc lập phụ lục sửa đổi hợp đồng:
// - Kiểm tra ID hợp đồng hợp lệ.
// - Khóa phiên bản lạc quan (ExpectedVersion): Bắt buộc người sửa phải biết rõ mình đang sửa trên bản hợp đồng số mấy.
//   Nếu trong lúc nhân viên này thao tác mà có một đồng nghiệp khác đã sửa xong trước, hệ thống sẽ từ chối (409 Conflict)
//   để người này đối soát lại, tránh tình trạng "ghi đè mất trắng dữ liệu của nhau".
// - Thẩm định toàn bộ các tiêu chí mới trước khi cho phép lưu.
func UpdateRule(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Kiểm tra định dạng hồ sơ gửi lên
		if strings.Split(c.GetHeader("Content-Type"), ";")[0] != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}

		// Giới hạn 64KB kích thước gói dữ liệu
		reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
		d := json.NewDecoder(reader)
		d.DisallowUnknownFields()

		var req dto.UpdateRuleRequest
		if err := d.Decode(&req); err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				c.String(http.StatusRequestEntityTooLarge, "request body exceeds 64KB limit")
				return
			}
			c.String(http.StatusBadRequest, "invalid JSON")
			return
		}
		if err := d.Decode(new(any)); err != io.EOF {
			c.String(http.StatusBadRequest, "trailing JSON")
			return
		}

		// Bước 2: Kiểm tra tính hợp lệ của mã định danh luật cần sửa
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.String(http.StatusBadRequest, "invalid rule ID")
			return
		}

		// Bước 3: Kiểm tra phiên bản kỳ vọng (Optimistic Lock)
		if req.ExpectedVersion < 1 {
			c.String(http.StatusUnprocessableEntity, "invalid expected version")
			return
		}

		// Bước 4: Thẩm định và làm sạch các trường dữ liệu điều chỉnh
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" || len(req.Name) > 120 || !utf8.ValidString(req.Name) ||
			len(req.Description) > 2000 || !utf8.ValidString(req.Description) ||
			req.Score < 0 || req.Score > 1000 || req.Priority < 0 || req.Priority > 1000000 ||
			!strings.HasPrefix(req.Path, "/") || len(req.Path) > 8192 || strings.ContainsAny(req.Path, "%?#\\\\") || strings.Contains(req.Path, "//") {
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}
		for _, b := range []byte(req.Path) {
			if b <= 32 || b >= 127 {
				c.String(http.StatusUnprocessableEntity, "invalid rule")
				return
			}
		}
		for _, segment := range strings.Split(req.Path, "/") {
			if segment == "." || segment == ".." {
				c.String(http.StatusUnprocessableEntity, "invalid rule")
				return
			}
		}
		switch req.Action {
		case "allow", "log", "block":
		default:
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}
		switch req.Severity {
		case "low", "medium", "high", "critical":
		default:
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}
		switch req.Group {
		case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
		default:
			c.String(http.StatusUnprocessableEntity, "invalid rule")
			return
		}

		// Bước 5: Ánh xạ dữ liệu sang entity UpdateRuleCommand
		cmd := entity.UpdateRuleCommand{
			ID:              id,
			ExpectedVersion: req.ExpectedVersion,
			Name:            req.Name,
			Description:     req.Description,
			Group:           req.Group,
			Action:          req.Action,
			Severity:        req.Severity,
			Score:           req.Score,
			Priority:        req.Priority,
			Path:            req.Path,
			Enabled:         req.Enabled,
		}

		// Bước 6: Thực thi điều chỉnh tại tầng Service
		out, err := s.Update(c.Request.Context(), cmd)
		if err != nil {
			switch {
			case errors.Is(err, taxonomy.ErrRuleNotFound):
				c.String(http.StatusNotFound, err.Error())
			case errors.Is(err, taxonomy.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, taxonomy.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error()) // Xung đột phiên bản (Đã có người sửa trước)
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}

		// Bước 7: Trả về kết quả phiên bản mới được cập nhật
		c.JSON(http.StatusOK, gin.H{
			"id":      strconv.FormatInt(out.ID, 10),
			"version": out.Version,
		})
	}
}

// ─── 3. List Rules (GET /api/v1/rules — Danh mục luật & Phân trang) ───────────

// ListRules tiếp nhận các bộ lọc tra cứu và trả về danh sách luật đã được phân trang.
//
// [Góc nhìn kinh tế / đối soát dữ liệu]:
// Giống như việc in sao kê danh mục hợp đồng:
// - Tiếp nhận tiêu chí tìm kiếm (từ khóa, nhóm, hành vi, mức độ rủi ro, trạng thái bật/tắt).
// - Áp dụng giới hạn trang (Limit từ 1 đến 100 bản ghi, mặc định 50) và con trỏ (After) để người dùng cuộn xem mượt mà,
//   tránh tải ồ ạt làm treo trình duyệt và tốn băng thông đường truyền.
// - Trả về tổng số lượng (Total), danh sách thực thể và mốc con trỏ cho trang kế tiếp (NextAfter).
func ListRules(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Thẩm định tham số phân trang Limit (tối thiểu 1, tối đa 100)
		limit := 50
		var after int64
		var err error
		if limitStr := c.Query("limit"); limitStr != "" {
			limit, err = strconv.Atoi(limitStr)
			if err != nil || limit < 1 || limit > 100 {
				c.String(http.StatusUnprocessableEntity, "invalid limit")
				return
			}
		}

		// Thẩm định mốc con trỏ After
		if afterStr := c.Query("after"); afterStr != "" {
			after, err = strconv.ParseInt(afterStr, 10, 64)
			if err != nil || after < 0 {
				c.String(http.StatusUnprocessableEntity, "invalid cursor")
				return
			}
		}

		// Bước 2: Thẩm định từ khóa tìm kiếm tên luật (tối đa 120 ký tự)
		search := strings.TrimSpace(c.Query("search"))
		if len(search) > 120 {
			c.String(http.StatusUnprocessableEntity, "search keyword too long")
			return
		}

		// Thẩm định tiêu chí lọc theo nhóm nghiệp vụ
		group := c.Query("group")
		switch group {
		case "", "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
		default:
			c.String(http.StatusUnprocessableEntity, "unknown rule group")
			return
		}

		// Thẩm định tiêu chí lọc theo hành vi xử lý
		action := c.Query("action")
		switch action {
		case "", "allow", "block", "log":
		default:
			c.String(http.StatusUnprocessableEntity, "unknown action")
			return
		}

		// Thẩm định tiêu chí lọc theo mức độ rủi ro
		severity := c.Query("severity")
		switch severity {
		case "", "low", "medium", "high", "critical":
		default:
			c.String(http.StatusUnprocessableEntity, "unknown severity")
			return
		}

		// Thẩm định tiêu chí lọc theo trạng thái hoạt động (bật/tắt)
		enabled := c.Query("enabled")
		if enabled != "" && enabled != "true" && enabled != "false" {
			c.String(http.StatusUnprocessableEntity, "enabled filter must be true or false")
			return
		}

		// Bước 3: Đóng gói truy vấn và gọi tầng Service
		out, err := s.List(c.Request.Context(), entity.ListRulesQuery{
			Limit:    limit,
			After:    after,
			Search:   search,
			Group:    group,
			Action:   action,
			Severity: severity,
			Enabled:  enabled,
		})
		if err != nil {
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}

		// Bước 4: Chuyển đổi danh sách kết quả sang định dạng JSON inline bằng gin.H
		items := make([]gin.H, 0, len(out.Items))
		for _, item := range out.Items {
			items = append(items, gin.H{
				"schema_version": item.SchemaVersion,
				"runtime_ready":  item.RuntimeReady,
				"id":             strconv.FormatInt(item.ID, 10),
				"version":        item.Version,
				"name":           item.Name,
				"description":    item.Description,
				"group":          item.Group,
				"action":         item.Action,
				"severity":       item.Severity,
				"score":          item.Score,
				"priority":       item.Priority,
				"path":           item.Path,
				"enabled":        item.Enabled,
				"updated_at":     item.UpdatedAt,
			})
		}
		resp := gin.H{
			"total": out.Total,
			"items": items,
		}
		if out.NextAfter != "" {
			resp["next_after"] = out.NextAfter
		}
		c.JSON(http.StatusOK, resp)
	}
}

// ─── 4. Rule Detail (GET /api/v1/rules/:id — Hồ sơ chi tiết của 1 luật) ────────

// RuleDetail trả về toàn bộ thông số kỹ thuật và các điều kiện lọc của một luật cụ thể.
//
// [Góc nhìn kinh tế]: Giống như việc mở một hợp đồng bảo hiểm cụ thể ra xem từng điều khoản chi tiết.
func RuleDetail(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Đọc và kiểm tra ID luật
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.String(http.StatusBadRequest, "invalid rule ID")
			return
		}

		// Bước 2: Đọc dữ liệu chi tiết từ tầng Service
		out, err := s.Detail(c.Request.Context(), entity.RuleDetailQuery{ID: id})
		if err != nil {
			if errors.Is(err, taxonomy.ErrRuleNotFound) {
				c.String(http.StatusNotFound, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}

		// Bước 3: Định dạng danh sách các điều kiện kiểm tra (Conditions) thành danh sách gin.H
		conditions := make([]gin.H, 0, len(out.Conditions))
		for _, cond := range out.Conditions {
			conditions = append(conditions, gin.H{
				"field":       cond.Field,
				"operator":    cond.Operator,
				"value":       cond.Value,
				"header_name": cond.HeaderName,
			})
		}

		// Bước 4: Phản hồi toàn bộ hồ sơ chi tiết inline
		c.JSON(http.StatusOK, gin.H{
			"schema_version":    out.SchemaVersion,
			"runtime_ready":     out.RuntimeReady,
			"runtime_issues":    out.RuntimeIssues,
			"logic_mode":        out.LogicMode,
			"conditions":        conditions,
			"source_ip":         out.SourceIP,
			"host_domain":       out.HostDomain,
			"path_prefix":       out.PathPrefix,
			"http_method":       out.HTTPMethod,
			"response_code":     out.ResponseCode,
			"custom_response":   out.CustomResponse,
			"log_event":         out.LogEvent,
			"add_to_reputation": out.AddToReputation,
			"id":                strconv.FormatInt(out.ID, 10),
			"version":           out.Version,
			"name":              out.Name,
			"description":       out.Description,
			"group":             out.Group,
			"action":            out.Action,
			"severity":          out.Severity,
			"score":             out.Score,
			"priority":          out.Priority,
			"path":              out.Path,
			"enabled":           out.Enabled,
			"updated_at":        out.UpdatedAt,
		})
	}
}

// ─── 5. Rule Stats (GET /api/v1/rules/stats — Thống kê & Báo cáo tổng quan) ───

// RuleStats cung cấp các số liệu đo lường tổng thể về danh mục chính sách bảo mật WAF.
//
// [Góc nhìn kinh tế / Dashboard giám đốc]:
// Báo cáo số dư tài sản an ninh:
// - Tổng số luật đang quản lý, số luật đang Bật, số luật ghi log, số luật chặn.
// - So sánh tăng giảm (Delta) so với mốc đầu tháng để lãnh đạo nắm được tốc độ phát triển và biến động của hệ thống.
func RuleStats(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		out, err := s.Stats(c.Request.Context(), entity.RuleStatsQuery{})
		if err != nil {
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"as_of":              out.AsOf,
			"comparison_before":  out.ComparisonBefore,
			"history_available":  out.HistoryAvailable,
			"total_delta":        out.TotalDelta,
			"enabled_delta":      out.EnabledDelta,
			"log_delta":          out.LogDelta,
			"block_delta":        out.BlockDelta,
			"total":              out.Total,
			"enabled":            out.Enabled,
			"log":                out.Log,
			"block":              out.Block,
		})
	}
}

// ─── 6. Publish Rules (POST /api/v1/rule-releases — Đóng gói & Phát hành) ─────

// PublishRules phát lệnh đóng gói toàn bộ các luật đang Bật thành một "Bản phát hành" (Release) sẵn sàng đưa vào vận hành.
//
// [Góc nhìn kinh tế / quản lý sản xuất]:
// Tương đương lệnh xuất xưởng lô hàng thành phẩm:
// - Yêu cầu thân Request Body phải rỗng (chỉ gửi tín hiệu kích hoạt lệnh).
// - Bắt buộc cung cấp mã Idempotency-Key để bảo đảm mỗi lần duyệt xuất xưởng chỉ tạo đúng một đợt phát hành duy nhất.
// - Sau khi gom các luật đang Bật, hệ thống sẽ đưa qua máy biên dịch (Compiler) để niêm phong đóng gói thành tệp nhị phân siêu nhanh cho Nginx.
func PublishRules(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Đảm bảo thân yêu cầu phải rỗng (chỉ là lệnh trigger)
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1))
		if err != nil || len(body) != 0 {
			c.String(http.StatusBadRequest, "publish body must be empty")
			return
		}

		// Bước 2: Kiểm tra khóa đối soát Idempotency
		key := c.GetHeader("Idempotency-Key")
		if len(key) < 16 || len(key) > 128 {
			c.String(http.StatusUnprocessableEntity, "invalid idempotency key")
			return
		}

		// Bước 3: Tiến hành đặt trước lô phát hành và chạy quy trình biên dịch
		out, err := s.Publish(c.Request.Context(), entity.PublishRulesCommand{RequestKey: key})
		if err != nil {
			switch {
			case errors.Is(err, taxonomy.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, taxonomy.ErrPublishUnavailable):
				c.String(http.StatusServiceUnavailable, err.Error()) // Máy biên dịch không sẵn sàng hoặc từ chối
			case errors.Is(err, taxonomy.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error()) // Xung đột khóa Idempotency
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}

		// Bước 4: Trả về thông tin lô hàng vừa phát hành kèm chữ ký niêm phong Digest
		c.JSON(http.StatusCreated, gin.H{
			"id":     strconv.FormatInt(out.ID, 10),
			"state":  out.State,
			"digest": out.Digest,
		})
	}
}

// ─── 7. Release Detail (GET /api/v1/rule-releases/:id — Tiến độ phân phối lô) ──

// ReleaseDetail tra cứu trạng thái và giai đoạn kích hoạt của một bản phát hành WAF.
//
// [Góc nhìn kinh tế / theo dõi đơn vận]:
// Giống như tra mã vận đơn xem lô hàng đã đến trạm phân phối nào, đang nạp dữ liệu hay đã chính thức có hiệu lực trên các node biên.
func ReleaseDetail(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.String(http.StatusBadRequest, "invalid release ID")
			return
		}
		out, err := s.Release(c.Request.Context(), entity.ReleaseDetailQuery{ID: id})
		if err != nil {
			switch {
			case errors.Is(err, taxonomy.ErrRuleNotFound):
				c.String(http.StatusNotFound, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"id":               strconv.FormatInt(out.ID, 10),
			"state":            out.State,
			"digest":           out.Digest,
			"created_at":       out.CreatedAt,
			"activation_phase": out.ActivationPhase,
		})
	}
}

// ─── 8. Create Rule Definition (POST /api/v2/rules — Tạo luật đa điều kiện v2) ──

// CreateRuleDefinition tiếp nhận và thẩm định hồ sơ luật WAF thế hệ 2 với các điều kiện soi chiếu thông minh (đa điều kiện).
//
// [Góc nhìn kinh tế / kiểm soát chi phí & rủi ro]:
// Tương đương việc soạn thảo hợp đồng khung phức tạp có nhiều điều khoản ràng buộc:
// - Kiểm tra ngân sách biểu thức chính quy (Regex Budget):
//   Biểu thức Regex ngốn rất nhiều CPU của máy chủ khi soi từng gói tin HTTP. Do đó hệ thống áp dụng cơ chế "Ngân sách tính toán":
//   Mỗi điều kiện regex tối đa 1024 bytes, tổng ngân sách regex của toàn bộ luật không vượt quá 4096 bytes để bảo vệ chi phí vận hành.
// - Hạn chế tối đa từ 1 đến 16 điều kiện có thứ tự để máy chủ lọc gói tin không bị trễ thời gian phản hồi (Latency thấp).
// - Kiểm tra tính hợp lệ của dải mạng CIDR, địa chỉ IP, Domain, HTTP Method và mã lỗi HTTP phản hồi khi bị Chặn (400, 403, 429, 500).
func CreateRuleDefinition(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Bước 1: Kiểm tra định dạng đơn JSON
		media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || media != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}

		// Bước 2: Giới hạn kích thước gói dữ liệu dưới 64KB
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 65536))
		if err != nil {
			c.String(http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		if !utf8.Valid(body) || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
			c.String(http.StatusBadRequest, "JSON object required")
			return
		}

		// Bước 3: Giải mã nội dung vào DTO CreateRuleDefinitionRequest
		var req dto.CreateRuleDefinitionRequest
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&req); err != nil {
			c.String(http.StatusBadRequest, "invalid JSON or unknown field")
			return
		}
		if err = decoder.Decode(new(any)); err != io.EOF {
			c.String(http.StatusBadRequest, "trailing JSON")
			return
		}

		// Bước 4: Kiểm tra khóa chống trùng Idempotency-Key
		key := c.GetHeader("Idempotency-Key")

		// Bước 5: Bắt đầu thẩm định chi tiết từng điều khoản tại quầy tiếp nhận (Inline Validation)
		invalid := map[string]string{}
		if len(key) < 16 || len(key) > 128 {
			invalid["idempotency_key"] = "Use a stable key of 16..128 characters for this submission"
		}
		req.Name = strings.TrimSpace(req.Name)
		if req.Name == "" || len(req.Name) > 120 || !utf8.ValidString(req.Name) {
			invalid["name"] = "Required, at most 120 UTF-8 bytes"
		}
		if len(req.Description) > 2000 || !utf8.ValidString(req.Description) {
			invalid["description"] = "At most 2000 UTF-8 bytes"
		}
		if req.Priority < 0 || req.Priority > 1000000 {
			invalid["priority"] = "Must be between 0 and 1000000"
		}
		if req.Score < 0 || req.Score > 1000 {
			invalid["score"] = "Must be between 0 and 1000"
		}
		switch req.Group {
		case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
		default:
			invalid["group"] = "Unknown rule group"
		}
		switch req.Severity {
		case "low", "medium", "high", "critical":
		default:
			invalid["severity"] = "Unknown severity"
		}
		if req.PolicyID != nil {
			invalid["policy_id"] = "Create unassigned; policy binding is a separate workflow"
		}

		// Chế độ kết hợp điều kiện: 'all' (thỏa mãn tất cả) hoặc 'any' (thỏa mãn bất kỳ)
		if req.LogicMode != "all" && req.LogicMode != "any" {
			invalid["logic_mode"] = "Use all or any"
		}

		// Giới hạn số lượng điều kiện từ 1 đến 16
		if len(req.Conditions) < 1 || len(req.Conditions) > 16 {
			invalid["conditions"] = "Supply 1..16 ordered conditions"
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"code":   "invalid_rule_definition",
				"fields": invalid,
			})
			return
		}

		// Bước 6: Kiểm tra từng điều kiện cụ thể và kiểm soát "Ngân sách tính toán" (Regex Budget)
		totalPatternBytes := 0
		for i, condition := range req.Conditions {
			prefix := fmt.Sprintf("conditions[%d]", i)
			switch condition.Field {
			case "uri_raw", "path", "query", "header", "body", "client_ip", "method":
			default:
				invalid[prefix+".field"] = "Unknown request field"
			}
			switch condition.Operator {
			case "equals", "contains", "starts_with", "ends_with", "regex", "cidr":
			default:
				invalid[prefix+".operator"] = "Unknown operator"
			}
			if condition.Value == "" || len(condition.Value) > 8192 || !utf8.ValidString(condition.Value) || strings.ContainsRune(condition.Value, 0) {
				invalid[prefix+".value"] = "Required, at most 8192 UTF-8 bytes, no NUL"
			}
			if condition.Field == "header" {
				if len(condition.HeaderName) < 1 || len(condition.HeaderName) > 128 {
					invalid[prefix+".header_name"] = "Header name required (max 128 bytes)"
				}
				for _, b := range []byte(condition.HeaderName) {
					if !(b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.ContainsRune("!#$%&'*+-.^_\x60|~", rune(b))) {
						invalid[prefix+".header_name"] = "Invalid HTTP header token"
					}
				}
			} else if condition.HeaderName != "" {
				invalid[prefix+".header_name"] = "Only valid for header conditions"
			}
			if condition.Operator == "cidr" {
				if condition.Field != "client_ip" {
					invalid[prefix+".operator"] = "CIDR operator requires client_ip"
				}
				if _, err := netip.ParsePrefix(condition.Value); err != nil {
					invalid[prefix+".value"] = "Invalid IPv4/IPv6 CIDR"
				}
			} else if condition.Field == "client_ip" {
				if condition.Operator != "equals" {
					invalid[prefix+".operator"] = "Client IP supports equals or cidr"
				}
				if _, err := netip.ParseAddr(condition.Value); err != nil {
					invalid[prefix+".value"] = "Invalid IPv4/IPv6 address"
				}
			}
			if condition.Operator == "regex" {
				totalPatternBytes += len(condition.Value)
				if len(condition.Value) > 1024 {
					invalid[prefix+".value"] = "Regex limited to 1024 bytes"
				} else if _, err := regexp.Compile(condition.Value); err != nil {
					invalid[prefix+".value"] = "Invalid RE2-compatible regex (no backreferences/lookaround)"
				}
			}
		}

		// Kiểm soát tổng ngân sách Regex không vượt quá 4096 bytes để bảo vệ CPU
		if totalPatternBytes > 4096 {
			invalid["conditions"] = "Combined regex budget is 4096 bytes"
		}

		// Bước 7: Kiểm tra cấu hình hành vi và phản hồi tùy biến khi Chặn
		switch req.Action {
		case "allow", "log":
			if req.ResponseCode != nil {
				invalid["response_code"] = "Only block controls the HTTP response"
			}
			if req.CustomResponse != "" {
				invalid["custom_response"] = "Only block accepts a response body"
			}
		case "block":
			if req.ResponseCode == nil {
				invalid["response_code"] = "Required for block"
			} else {
				switch *req.ResponseCode {
				case 400, 403, 429, 500:
				default:
					invalid["response_code"] = "Use 400, 403, 429 or 500"
				}
			}
		default:
			invalid["action"] = "Supported definitions: allow, log, block; CAPTCHA is not available"
		}
		if utf8.RuneCountInString(req.CustomResponse) > 512 || !utf8.ValidString(req.CustomResponse) || strings.ContainsRune(req.CustomResponse, 0) {
			invalid["custom_response"] = "At most 512 characters, no NUL"
		}

		// Bước 8: Thẩm định địa chỉ IP nguồn (Source IP), Tên miền máy chủ (Host Domain), Tiền tố đường dẫn và Phương thức HTTP
		if req.SourceIP != "" {
			entries := strings.Split(req.SourceIP, ",")
			if len(entries) > 32 || len(req.SourceIP) > 2048 {
				invalid["source_ip"] = "At most 32 addresses/CIDRs, 2048 bytes"
			}
			for _, entry := range entries {
				entry = strings.TrimSpace(entry)
				_, a := netip.ParseAddr(entry)
				_, p := netip.ParsePrefix(entry)
				if a != nil && p != nil {
					invalid["source_ip"] = "Use comma-separated IPv4/IPv6 addresses or CIDRs"
				}
			}
		}
		if req.HostDomain != "" {
			if len(req.HostDomain) > 253 {
				invalid["host_domain"] = "Hostname too long"
			}
			for _, label := range strings.Split(req.HostDomain, ".") {
				if len(label) < 1 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
					invalid["host_domain"] = "Use an ASCII hostname without scheme, port or wildcard"
				}
				for _, b := range []byte(label) {
					if !(b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || b == '-') {
						invalid["host_domain"] = "Use an ASCII hostname without scheme, port or wildcard"
					}
				}
			}
		}
		if req.PathPrefix != "" && (!strings.HasPrefix(req.PathPrefix, "/") || len(req.PathPrefix) > 8192 || strings.ContainsAny(req.PathPrefix, "\x00\r\n?#")) {
			invalid["path_prefix"] = "Use a path prefix, max 8192 bytes, without query/fragment/controls"
		}
		for _, b := range []byte(req.PathPrefix) {
			if b < 32 || b == 127 {
				invalid["path_prefix"] = "Path prefix must not contain control characters"
			}
		}
		switch req.HTTPMethod {
		case "", "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
		default:
			invalid["http_method"] = "Unknown HTTP method"
		}

		// Nếu phát hiện bất kỳ lỗi thẩm định nào, trả về danh sách chi tiết mã lỗi 422 Unprocessable Entity
		if len(invalid) > 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"code":   "invalid_rule_definition",
				"fields": invalid,
			})
			return
		}

		// Bước 9: Ánh xạ từ DTO sang Flat Command Entity chuẩn bị chuyển sang tầng Service
		conditions := make([]entity.CreateRuleCondition, len(req.Conditions))
		for i, cond := range req.Conditions {
			conditions[i] = entity.CreateRuleCondition{
				Field:      cond.Field,
				Operator:   cond.Operator,
				Value:      cond.Value,
				HeaderName: cond.HeaderName,
			}
		}
		cmd := entity.CreateRuleDefinitionCommand{
			RequestKey:      key,
			Name:            req.Name,
			Description:     req.Description,
			Group:           req.Group,
			Severity:        req.Severity,
			Score:           req.Score,
			Enabled:         req.Enabled,
			Priority:        req.Priority,
			PolicyID:        req.PolicyID,
			LogicMode:       req.LogicMode,
			Conditions:      conditions,
			Action:          req.Action,
			ResponseCode:    req.ResponseCode,
			CustomResponse:  req.CustomResponse,
			LogEvent:        req.LogEvent,
			AddToReputation: req.AddToReputation,
			SourceIP:        req.SourceIP,
			HostDomain:      req.HostDomain,
			PathPrefix:      req.PathPrefix,
			HTTPMethod:      req.HTTPMethod,
		}

		// Bước 10: Thực thi tạo luật đa điều kiện trong Service
		out, err := s.CreateDefinition(c.Request.Context(), cmd)
		if err != nil {
			if errors.Is(err, taxonomy.ErrRuleConflict) {
				c.String(http.StatusConflict, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}

		// Bước 11: Đính kèm Header Location chỉ đường đến tài nguyên vừa tạo và trả về JSON inline
		c.Header("Location", "/api/v1/rules/"+strconv.FormatInt(out.ID, 10))
		c.JSON(http.StatusCreated, gin.H{
			"id":             strconv.FormatInt(out.ID, 10),
			"version":        out.Version,
			"state":          out.State,
			"runtime_ready":  out.RuntimeReady,
			"runtime_issues": out.RuntimeIssues,
		})
	}
}
