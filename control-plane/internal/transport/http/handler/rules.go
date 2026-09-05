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
		if err := d.Decode(new(any)); err != io.EOF {
			c.String(http.StatusBadRequest, "trailing JSON")
			return
		}

		key := c.GetHeader("Idempotency-Key")
		if len(key) < 16 || len(key) > 128 {
			c.String(http.StatusUnprocessableEntity, "invalid idempotency key")
			return
		}

		// Validate và sanitize raw input trực tiếp tại handler (inline)
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

		out, err := s.Create(c.Request.Context(), cmd)
		if err != nil {
			switch {
			case errors.Is(err, taxonomy.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, taxonomy.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusCreated, gin.H{
			"id":      strconv.FormatInt(out.ID, 10),
			"version": out.Version,
		})
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

		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.String(http.StatusBadRequest, "invalid rule ID")
			return
		}

		if req.ExpectedVersion < 1 {
			c.String(http.StatusUnprocessableEntity, "invalid expected version")
			return
		}

		// Validate và sanitize raw input trực tiếp tại handler (inline)
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

		out, err := s.Update(c.Request.Context(), cmd)
		if err != nil {
			switch {
			case errors.Is(err, taxonomy.ErrRuleNotFound):
				c.String(http.StatusNotFound, err.Error())
			case errors.Is(err, taxonomy.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, taxonomy.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"id":      strconv.FormatInt(out.ID, 10),
			"version": out.Version,
		})
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
			if err != nil || limit < 1 || limit > 100 {
				c.String(http.StatusUnprocessableEntity, "invalid limit")
				return
			}
		}
		if afterStr := c.Query("after"); afterStr != "" {
			after, err = strconv.ParseInt(afterStr, 10, 64)
			if err != nil || after < 0 {
				c.String(http.StatusUnprocessableEntity, "invalid cursor")
				return
			}
		}

		search := strings.TrimSpace(c.Query("search"))
		if len(search) > 120 {
			c.String(http.StatusUnprocessableEntity, "search keyword too long")
			return
		}

		group := c.Query("group")
		switch group {
		case "", "custom", "sqli", "xss", "traversal", "bot", "endpoint", "authentication":
		default:
			c.String(http.StatusUnprocessableEntity, "unknown rule group")
			return
		}

		action := c.Query("action")
		switch action {
		case "", "allow", "block", "log":
		default:
			c.String(http.StatusUnprocessableEntity, "unknown action")
			return
		}

		severity := c.Query("severity")
		switch severity {
		case "", "low", "medium", "high", "critical":
		default:
			c.String(http.StatusUnprocessableEntity, "unknown severity")
			return
		}

		enabled := c.Query("enabled")
		if enabled != "" && enabled != "true" && enabled != "false" {
			c.String(http.StatusUnprocessableEntity, "enabled filter must be true or false")
			return
		}

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
			if errors.Is(err, taxonomy.ErrRuleNotFound) {
				c.String(http.StatusNotFound, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		conditions := make([]gin.H, 0, len(out.Conditions))
		for _, cond := range out.Conditions {
			conditions = append(conditions, gin.H{
				"field":       cond.Field,
				"operator":    cond.Operator,
				"value":       cond.Value,
				"header_name": cond.HeaderName,
			})
		}
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

// ─── 5. Rule Stats (GET /api/v1/rules/stats) ──────────────────────────────────

// RuleStats xử lý GET /api/v1/rules/stats — trả về các số đếm thống kê.
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
			case errors.Is(err, taxonomy.ErrRuleInvalid):
				c.String(http.StatusUnprocessableEntity, err.Error())
			case errors.Is(err, taxonomy.ErrPublishUnavailable):
				c.String(http.StatusServiceUnavailable, err.Error())
			case errors.Is(err, taxonomy.ErrRuleConflict):
				c.String(http.StatusConflict, err.Error())
			default:
				c.String(http.StatusInternalServerError, "rules operation failed")
			}
			return
		}
		c.JSON(http.StatusCreated, gin.H{
			"id":     strconv.FormatInt(out.ID, 10),
			"state":  out.State,
			"digest": out.Digest,
		})
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

		key := c.GetHeader("Idempotency-Key")

		// Thẩm định và sanitize trực tiếp raw payload tại call site (inline)
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
		if req.LogicMode != "all" && req.LogicMode != "any" {
			invalid["logic_mode"] = "Use all or any"
		}
		if len(req.Conditions) < 1 || len(req.Conditions) > 16 {
			invalid["conditions"] = "Supply 1..16 ordered conditions"
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"code":   "invalid_rule_definition",
				"fields": invalid,
			})
			return
		}
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
		if totalPatternBytes > 4096 {
			invalid["conditions"] = "Combined regex budget is 4096 bytes"
		}
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
		if len(invalid) > 0 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{
				"code":   "invalid_rule_definition",
				"fields": invalid,
			})
			return
		}

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

		out, err := s.CreateDefinition(c.Request.Context(), cmd)
		if err != nil {
			if errors.Is(err, taxonomy.ErrRuleConflict) {
				c.String(http.StatusConflict, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
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
