package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
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

// ─── Validation Helpers (Thẩm định & Chuẩn hóa định dạng HTTP thô) ─────────────

// validateRulePayload kiểm tra tính hợp lệ về mặt cú pháp và khuôn dạng của Rule cơ bản (v1).
func validateRulePayload(name, description, path, action, severity, group string, score, priority int) error {
	if strings.TrimSpace(name) == "" || len(name) > 120 || !utf8.ValidString(name) ||
		len(description) > 2000 || !utf8.ValidString(description) ||
		score < 0 || score > 1000 || priority < 0 || priority > 1000000 ||
		!strings.HasPrefix(path, "/") || len(path) > 8192 || strings.ContainsAny(path, "%?#\\\\") || strings.Contains(path, "//") {
		return entity.ErrRuleInvalid
	}
	for _, b := range []byte(path) {
		if b <= 32 || b >= 127 {
			return entity.ErrRuleInvalid
		}
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." {
			return entity.ErrRuleInvalid
		}
	}
	switch action {
	case "allow", "log", "block":
	default:
		return entity.ErrRuleInvalid
	}
	switch severity {
	case "low", "medium", "high", "critical":
	default:
		return entity.ErrRuleInvalid
	}
	switch group {
	case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
	default:
		return entity.ErrRuleInvalid
	}
	return nil
}

// validateListRulesQuery kiểm tra các tham số phân trang và lọc danh sách.
func validateListRulesQuery(q entity.ListRulesQuery) error {
	if q.Limit < 1 || q.Limit > 100 || q.After < 0 || len(q.Search) > 120 || (q.Enabled != "" && q.Enabled != "true" && q.Enabled != "false") {
		return entity.ErrRuleInvalid
	}
	switch q.Group {
	case "", "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
	default:
		return entity.ErrRuleInvalid
	}
	switch q.Action {
	case "", "allow", "block", "log":
	default:
		return entity.ErrRuleInvalid
	}
	switch q.Severity {
	case "", "low", "medium", "high", "critical":
	default:
		return entity.ErrRuleInvalid
	}
	return nil
}

// validateRuleDefinitionPayload thẩm định chi tiết payload điều kiện nâng cao (v2 multi-condition).
func validateRuleDefinitionPayload(c entity.CreateRuleDefinitionCommand) *entity.CreateRuleFieldError {
	invalid := map[string]string{}
	if len(c.RequestKey) < 16 || len(c.RequestKey) > 128 {
		invalid["idempotency_key"] = "Use a stable key of 16..128 characters for this submission"
	}
	if strings.TrimSpace(c.Name) == "" || len(c.Name) > 120 || !utf8.ValidString(c.Name) {
		invalid["name"] = "Required, at most 120 UTF-8 bytes"
	}
	if len(c.Description) > 2000 || !utf8.ValidString(c.Description) {
		invalid["description"] = "At most 2000 UTF-8 bytes"
	}
	if c.Priority < 0 || c.Priority > 1000000 {
		invalid["priority"] = "Must be between 0 and 1000000"
	}
	if c.Score < 0 || c.Score > 1000 {
		invalid["score"] = "Must be between 0 and 1000"
	}
	switch c.Group {
	case "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
	default:
		invalid["group"] = "Unknown rule group"
	}
	switch c.Severity {
	case "low", "medium", "high", "critical":
	default:
		invalid["severity"] = "Unknown severity"
	}
	if c.PolicyID != nil {
		invalid["policy_id"] = "Create unassigned; policy binding is a separate workflow"
	}
	if c.LogicMode != "all" && c.LogicMode != "any" {
		invalid["logic_mode"] = "Use all or any"
	}
	if len(c.Conditions) < 1 || len(c.Conditions) > 16 {
		invalid["conditions"] = "Supply 1..16 ordered conditions"
		return &entity.CreateRuleFieldError{Fields: invalid}
	}
	totalPatternBytes := 0
	for i, condition := range c.Conditions {
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
	if totalPatternBytes > 4096 {
		invalid["conditions"] = "Combined regex budget is 4096 bytes"
	}
	switch c.Action {
	case "allow", "log":
		if c.ResponseCode != nil {
			invalid["response_code"] = "Only block controls the HTTP response"
		}
		if c.CustomResponse != "" {
			invalid["custom_response"] = "Only block accepts a response body"
		}
	case "block":
		if c.ResponseCode == nil {
			invalid["response_code"] = "Required for block"
		} else {
			switch *c.ResponseCode {
			case 400, 403, 429, 500:
			default:
				invalid["response_code"] = "Use 400, 403, 429 or 500"
			}
		}
	default:
		invalid["action"] = "Supported definitions: allow, log, block; CAPTCHA is not available"
	}
	if utf8.RuneCountInString(c.CustomResponse) > 512 || !utf8.ValidString(c.CustomResponse) || strings.ContainsRune(c.CustomResponse, 0) {
		invalid["custom_response"] = "At most 512 characters, no NUL"
	}
	if c.SourceIP != "" {
		entries := strings.Split(c.SourceIP, ",")
		if len(entries) > 32 || len(c.SourceIP) > 2048 {
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
	if c.HostDomain != "" {
		if len(c.HostDomain) > 253 {
			invalid["host_domain"] = "Hostname too long"
		}
		for _, label := range strings.Split(c.HostDomain, ".") {
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
	if c.PathPrefix != "" && (!strings.HasPrefix(c.PathPrefix, "/") || len(c.PathPrefix) > 8192 || strings.ContainsAny(c.PathPrefix, "\x00\r\n?#")) {
		invalid["path_prefix"] = "Use a path prefix, max 8192 bytes, without query/fragment/controls"
	}
	for _, b := range []byte(c.PathPrefix) {
		if b < 32 || b == 127 {
			invalid["path_prefix"] = "Path prefix must not contain control characters"
		}
	}
	switch c.HTTPMethod {
	case "", "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
	default:
		invalid["http_method"] = "Unknown HTTP method"
	}
	if len(invalid) > 0 {
		return &entity.CreateRuleFieldError{Fields: invalid}
	}
	return nil
}

// ─── 1. Create Rule (POST /api/v1/rules) ──────────────────────────────────────

// CreateRule xử lý POST /api/v1/rules — tạo một rule WAF mới.
func CreateRule(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.Split(c.GetHeader("Content-Type"), ";")[0] != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}
		reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
		d := json.NewDecoder(reader)
		d.DisallowUnknownFields()
		var cmd entity.CreateRuleCommand
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

		key := c.GetHeader("Idempotency-Key")
		if len(key) < 16 || len(key) > 128 {
			c.String(http.StatusUnprocessableEntity, "invalid idempotency key")
			return
		}
		cmd.RequestKey = key

		// Chuẩn hóa và thẩm định dữ liệu đầu vào thô
		cmd.Name = strings.TrimSpace(cmd.Name)
		if err := validateRulePayload(cmd.Name, cmd.Description, cmd.Path, cmd.Action, cmd.Severity, cmd.Group, cmd.Score, cmd.Priority); err != nil {
			c.String(http.StatusUnprocessableEntity, err.Error())
			return
		}

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

// ─── 2. Update Rule (PUT /api/v1/rules/:id) ───────────────────────────────────

// UpdateRule xử lý PUT /api/v1/rules/:id — cập nhật toàn bộ nội dung rule.
func UpdateRule(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.Split(c.GetHeader("Content-Type"), ";")[0] != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}
		reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
		d := json.NewDecoder(reader)
		d.DisallowUnknownFields()
		var cmd entity.UpdateRuleCommand
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

		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.String(http.StatusBadRequest, "invalid rule ID")
			return
		}
		cmd.ID = id

		if cmd.ExpectedVersion < 1 {
			c.String(http.StatusUnprocessableEntity, "invalid expected version")
			return
		}

		cmd.Name = strings.TrimSpace(cmd.Name)
		if err := validateRulePayload(cmd.Name, cmd.Description, cmd.Path, cmd.Action, cmd.Severity, cmd.Group, cmd.Score, cmd.Priority); err != nil {
			c.String(http.StatusUnprocessableEntity, err.Error())
			return
		}

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

// ─── 3. List Rules (GET /api/v1/rules) ────────────────────────────────────────

// ListRules xử lý GET /api/v1/rules — trả về danh sách rule có phân trang.
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

		query := entity.ListRulesQuery{
			Limit:    limit,
			After:    after,
			Search:   strings.TrimSpace(c.Query("search")),
			Group:    c.Query("group"),
			Action:   c.Query("action"),
			Severity: c.Query("severity"),
			Enabled:  c.Query("enabled"),
		}

		// Thẩm định query params thô ngay tại handler
		if err := validateListRulesQuery(query); err != nil {
			c.String(http.StatusUnprocessableEntity, err.Error())
			return
		}

		out, err := s.List(c.Request.Context(), query)
		if err != nil {
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		c.JSON(http.StatusOK, out)
	}
}

// ─── 4. Rule Detail (GET /api/v1/rules/:id) ───────────────────────────────────

// RuleDetail xử lý GET /api/v1/rules/:id — trả về chi tiết đầy đủ của một rule.
func RuleDetail(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
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

// ─── 5. Rule Stats (GET /api/v1/rules/stats) ──────────────────────────────────

// RuleStats xử lý GET /api/v1/rules/stats — trả về các số đếm thống kê.
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

// ─── 6. Publish Rules (POST /api/v1/rule-releases) ────────────────────────────

// PublishRules xử lý POST /api/v1/rule-releases — đóng gói bộ rule thành một "release".
func PublishRules(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1))
		if err != nil || len(body) != 0 {
			c.String(http.StatusBadRequest, "publish body must be empty")
			return
		}
		key := c.GetHeader("Idempotency-Key")
		if len(key) < 16 || len(key) > 128 {
			c.String(http.StatusUnprocessableEntity, "invalid idempotency key")
			return
		}
		out, err := s.Publish(c.Request.Context(), entity.PublishRulesCommand{RequestKey: key})
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

// ─── 7. Release Detail (GET /api/v1/rule-releases/:id) ─────────────────────────

// ReleaseDetail xử lý GET /api/v1/rule-releases/:id — trả về trạng thái của một release.
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
			case errors.Is(err, entity.ErrRuleNotFound):
				c.String(http.StatusNotFound, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusOK, out)
	}
}

// ─── 8. Create Rule Definition (POST /api/v2/rules) ───────────────────────────

// CreateRuleDefinition xử lý POST /api/v2/rules — tạo rule WAF với điều kiện nâng cao (v2 multi-condition).
func CreateRuleDefinition(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || media != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 65536))
		if err != nil {
			c.String(http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		if !utf8.Valid(body) || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
			c.String(http.StatusBadRequest, "JSON object required")
			return
		}
		var cmd entity.CreateRuleDefinitionCommand
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&cmd); err != nil {
			c.String(http.StatusBadRequest, "invalid JSON or unknown field")
			return
		}
		if err = decoder.Decode(new(any)); err != io.EOF {
			c.String(http.StatusBadRequest, "trailing JSON")
			return
		}

		cmd.RequestKey = c.GetHeader("Idempotency-Key")

		// Thẩm định và sanitize toàn bộ raw payload tại tầng handler
		if invalid := validateRuleDefinitionPayload(cmd); invalid != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"code":   "invalid_rule_definition",
				"fields": invalid.Fields,
			})
			return
		}

		out, err := s.CreateDefinition(c.Request.Context(), cmd)
		if err != nil {
			if errors.Is(err, entity.ErrRuleConflict) {
				c.String(http.StatusConflict, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		c.Header("Location", "/api/v1/rules/"+strconv.FormatInt(out.ID, 10))
		c.JSON(http.StatusCreated, out)
	}
}
