package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// CreateRule xử lý POST /api/v1/rules — tạo một rule WAF mới.
//
// Luồng:
//  1. Kiểm tra Content-Type phải là application/json (tránh nhận form, XML,...)
//  2. Đọc body tối đa 64KB (ngăn client gửi payload khổng lồ làm treo server)
//  3. DisallowUnknownFields: từ chối nếu JSON có trường lạ không thuộc struct
//     (ngăn client "nhét" dữ liệu ẩn mà server không biết)
//  4. Gán Idempotency-Key từ header vào cmd.RequestKey — nếu client gửi lại
//     cùng key, server trả về kết quả cũ thay vì tạo rule trùng
//  5. Gọi service.Create để validate nghiệp vụ và ghi vào DB
//
// Response:
//   - 201 Created  : tạo thành công, body JSON chứa id và version mới
//   - 400          : JSON sai định dạng hoặc có trailing garbage
//   - 409 Conflict : Idempotency-Key đã được dùng với payload khác
//   - 413          : body vượt 64KB
//   - 415          : Content-Type không phải application/json
//   - 422          : vi phạm business rule (tên trống, action không hợp lệ,...)
//   - 500          : lỗi hệ thống không xác định
func CreateRule(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var cmd entity.CreateRuleCommand
		if strings.Split(c.GetHeader("Content-Type"), ";")[0] != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}
		reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
		d := json.NewDecoder(reader)
		d.DisallowUnknownFields()
		if err := d.Decode(&cmd); err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				c.String(http.StatusRequestEntityTooLarge, "request body exceeds 64KB limit")
				return
			}
			c.String(http.StatusBadRequest, "invalid JSON")
			return
		}
		// Phát hiện JSON thừa sau object đầu tiên (ví dụ: `{...}{...}`)
		if err := d.Decode(new(any)); err != io.EOF {
			c.String(http.StatusBadRequest, "trailing JSON")
			return
		}
		cmd.RequestKey = c.GetHeader("Idempotency-Key")
		out, err := s.Create(c.Request.Context(), cmd)
		if err != nil {
			switch {
			case errors.Is(err, entity.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, entity.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusCreated, out)
	}
}

// UpdateRule xử lý PUT /api/v1/rules/:id — cập nhật toàn bộ nội dung rule.
//
// Lưu ý quan trọng:
//   - Đây là "optimistic locking": client phải gửi kèm expected_version.
//     Nếu version không khớp (ai đó đã sửa rule trước), server trả 409 Conflict.
//     Cơ chế này tránh 2 người cùng sửa rule và ghi đè lẫn nhau.
//   - Rule đã có v2 definition (conditions phức tạp) không thể bị ghi đè bằng
//     update v1 path đơn giản — trả 409 để bảo toàn dữ liệu.
//
// Response:
//   - 200 OK        : cập nhật thành công, trả về id và version mới
//   - 400           : JSON sai hoặc :id không phải số nguyên
//   - 404 Not Found : rule không tồn tại hoặc version không khớp
//   - 409 Conflict  : xung đột optimistic lock hoặc rule đã là v2 definition
//   - 415 / 413 / 422 : tương tự CreateRule
func UpdateRule(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		var cmd entity.UpdateRuleCommand
		if strings.Split(c.GetHeader("Content-Type"), ";")[0] != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}
		reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
		d := json.NewDecoder(reader)
		d.DisallowUnknownFields()
		if err := d.Decode(&cmd); err != nil {
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
		// Lấy id từ URL path, ví dụ /api/v1/rules/42 → id=42
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.String(http.StatusBadRequest, "invalid rule ID")
			return
		}
		cmd.ID = id
		out, err := s.Update(c.Request.Context(), cmd)
		if err != nil {
			switch {
			case errors.Is(err, entity.ErrRuleNotFound):
				c.String(http.StatusNotFound, err.Error())
			case errors.Is(err, entity.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, entity.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusOK, out)
	}
}

// ListRules xử lý GET /api/v1/rules — trả về danh sách rule có phân trang.
//
// Query params:
//   - limit   : số rule tối đa mỗi trang (mặc định 50, tối đa 100)
//   - after   : cursor-based pagination — trả về rule có id > after
//               (hiệu quả hơn OFFSET truyền thống vì không quét lại từ đầu)
//   - search  : tìm kiếm theo tên (không phân biệt hoa thường)
//   - group   : lọc theo nhóm rule (sqli, xss, bot,...)
//   - action  : lọc theo hành động (allow, log, block)
//   - severity: lọc theo mức độ (low, medium, high, critical)
//   - enabled : lọc theo trạng thái ("true"/"false")
//
// Response body gồm:
//   - items      : danh sách rule
//   - total      : tổng số rule khớp filter (không phải số rule trong trang)
//   - next_after : cursor để lấy trang tiếp theo (rỗng nếu hết)
func ListRules(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit := 50
		var after int64
		var err error
		if limitStr := c.Query("limit"); limitStr != "" {
			limit, err = strconv.Atoi(limitStr)
			if err != nil {
				c.String(http.StatusBadRequest, "invalid limit")
				return
			}
		}
		if afterStr := c.Query("after"); afterStr != "" {
			after, err = strconv.ParseInt(afterStr, 10, 64)
			if err != nil {
				c.String(http.StatusBadRequest, "invalid cursor")
				return
			}
		}
		out, err := s.List(c.Request.Context(), entity.ListRulesQuery{
			Limit:    limit,
			After:    after,
			Search:   c.Query("search"),
			Group:    c.Query("group"),
			Action:   c.Query("action"),
			Severity: c.Query("severity"),
			Enabled:  c.Query("enabled"),
		})
		if err != nil {
			if errors.Is(err, entity.ErrRuleInvalid) {
				c.String(http.StatusUnprocessableEntity, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		c.JSON(http.StatusOK, out)
	}
}

// RuleDetail xử lý GET /api/v1/rules/:id — trả về chi tiết đầy đủ của một rule.
//
// Khác với ListRules (chỉ trả summary), RuleDetail trả về:
//   - Toàn bộ conditions (điều kiện kích hoạt rule)
//   - Trạng thái runtime (rule có sẵn sàng cho compiler không)
//   - Schema version (v1=path đơn giản, v2=multi-condition phức tạp)
func RuleDetail(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.String(http.StatusBadRequest, "invalid rule ID")
			return
		}
		out, err := s.Detail(c.Request.Context(), entity.RuleDetailQuery{ID: id})
		if err != nil {
			if errors.Is(err, entity.ErrRuleNotFound) {
				c.String(http.StatusNotFound, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		c.JSON(http.StatusOK, out)
	}
}

// RuleStats xử lý GET /api/v1/rules/stats — trả về các số đếm thống kê.
//
// Trả về:
//   - Tổng số rule, số đang bật, số theo action (log/block)
//   - Delta so với đầu tháng UTC (thêm bao nhiêu rule trong tháng này)
//   - Cờ history_available: nếu schema migration v2 đã áp dụng đủ lâu để
//     có số liệu baseline tháng trước
//
// Không nhận query param — snapshot toàn bộ DB trong một lần đọc duy nhất.
func RuleStats(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		out, err := s.Stats(c.Request.Context(), entity.RuleStatsQuery{})
		if err != nil {
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		c.JSON(http.StatusOK, out)
	}
}

// PublishRules xử lý POST /api/v1/rule-releases — đóng gói bộ rule thành
// một "release" để NGINX tải và áp dụng.
//
// Luồng publish:
//  1. Body phải HOÀN TOÀN RỖNG — không chấp nhận payload (không có gì để
//     inject vào quá trình publish)
//  2. Reserve: snapshot tất cả rule đang enabled vào một release_id mới
//  3. Compiler (aurora-compile binary): nhận JSON IR, xác nhận hợp lệ
//  4. Complete: đánh dấu release là "ready" và lưu digest SHA-256
//
// Idempotent qua Idempotency-Key: gửi lại cùng key trả về release cũ
// mà không tạo release trùng.
//
// Response:
//   - 201 Created         : release thành công, trả về id, state="ready", digest
//   - 400                 : body không rỗng
//   - 409 Conflict        : đang có publish đang chạy (chỉ 1 publish cùng lúc)
//   - 422                 : có rule enabled nhưng runtime_ready=false
//   - 503 Unavailable     : compiler không được cấu hình hoặc bị lỗi
func PublishRules(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Publication has no user-supplied artifact path, command, or mutable selection.
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1))
		if err != nil || len(body) != 0 {
			c.String(http.StatusBadRequest, "publish body must be empty")
			return
		}
		out, err := s.Publish(c.Request.Context(), entity.PublishRulesCommand{RequestKey: c.GetHeader("Idempotency-Key")})
		if err != nil {
			switch {
			case errors.Is(err, entity.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, entity.ErrPublishUnavailable):
				c.String(http.StatusServiceUnavailable, err.Error())
			case errors.Is(err, entity.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusCreated, out)
	}
}

// ReleaseDetail xử lý GET /api/v1/rule-releases/:id — trả về trạng thái
// của một release cụ thể.
//
// Dùng để polling sau khi publish:
//   - state="pending" : compiler đang xử lý (hoặc chưa hoàn thành)
//   - state="ready"   : release hợp lệ, sẵn sàng để aurora-activate áp dụng
//   - activation_phase: trạng thái NGINX reload (nếu đã kích hoạt)
func ReleaseDetail(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil {
			c.String(http.StatusBadRequest, "invalid release ID")
			return
		}
		out, err := s.Release(c.Request.Context(), entity.ReleaseDetailQuery{ID: id})
		if err != nil {
			switch {
			case errors.Is(err, entity.ErrRuleNotFound):
				c.String(http.StatusNotFound, err.Error())
			case errors.Is(err, entity.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusOK, out)
	}
}
