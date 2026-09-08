package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// Thời gian chờ tối đa cho các tác vụ Rate Limiting
const (
	rateLimitQueryTimeout  = 5 * time.Second  // Dành cho List, GetByID, GetStats, GetMetrics, Flush
	rateLimitChangeTimeout = 10 * time.Second // Dành cho Create, Update, Delete rule
)

// RateLimitCollectorPort định nghĩa các thao tác flush và toggle collector cho HTTP handler.
type RateLimitCollectorPort interface {
	Flush(ctx context.Context)
	SetEnabled(enabled bool)
}

// RateLimitHandler bao đóng các HTTP endpoint cho Rate Limit Rules workflow.
type RateLimitHandler struct {
	service   port.RateLimitService
	collector RateLimitCollectorPort
}

// NewRateLimitHandler khởi tạo handler với RateLimitService và RateLimitCollectorPort.
func NewRateLimitHandler(s port.RateLimitService, c RateLimitCollectorPort) *RateLimitHandler {
	return &RateLimitHandler{service: s, collector: c}
}

// Create xử lý HTTP POST /api/v1/rate-limits: Tạo mới một Rate Limit Rule.
func (h *RateLimitHandler) Create(c *gin.Context) {
	// Kiểm tra tiêu đề Content-Type — bắt buộc phải là application/json
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	// Giới hạn kích thước tối đa của request body là 64KB (65536 bytes) chống DoS
	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.CreateRateLimitRuleRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields() // Nghiêm cấm các trường dữ liệu lạ ngoài cấu trúc DTO

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body: " + err.Error()})
		return
	}

	// Đảm bảo không có dữ liệu lạ bám theo sau đối tượng JSON chính
	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rule name is required"})
		return
	}
	if len(req.Name) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rule name exceeds 120 characters"})
		return
	}
	if req.RateLimit <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rate_limit must be greater than 0"})
		return
	}

	cmd := entity.CreateRateLimitRuleCommand{
		Name:              req.Name,
		Description:       req.Description,
		EnabledDimensions: req.EnabledDimensions,
		DimensionOrder:    req.DimensionOrder,
		IpConfig: entity.RateLimitIpConfig{
			Source:     req.IpConfig.Source,
			SubnetMask: req.IpConfig.SubnetMask,
		},
		HeaderConfig: entity.RateLimitHeaderConfig{
			HeaderName:    req.HeaderConfig.HeaderName,
			Operator:      req.HeaderConfig.Operator,
			HeaderValue:   req.HeaderConfig.HeaderValue,
			CaseSensitive: req.HeaderConfig.CaseSensitive,
		},
		PathConfig: entity.RateLimitPathConfig{
			Path:      req.PathConfig.Path,
			MatchType: req.PathConfig.MatchType,
		},
		RateLimit:      req.RateLimit,
		RateUnit:       req.RateUnit,
		Burst:          req.Burst,
		ActionExceeded: req.ActionExceeded,
		CustomResponse: req.CustomResponse,
		ResponseCode:   req.ResponseCode,
		ResponseBody:   req.ResponseBody,
		LogEvents:      req.LogEvents,
		AddReputation:  req.AddReputation,
		EnableAlert:    req.EnableAlert,
		Status:         req.Status,
		CreatedBy:      "admin",
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitChangeTimeout)
	defer cancel()

	item, err := h.service.CreateRateLimitRule(ctx, cmd)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Thao tác tạo rate limit rule đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Tự map bằng gin.H theo đúng quy tắc, không qua helper mapping func
	c.JSON(http.StatusCreated, gin.H{
		"id":                 item.ID,
		"name":               item.Name,
		"description":        item.Description,
		"enabled_dimensions": item.EnabledDimensions,
		"dimension_order":    item.DimensionOrder,
		"ip_config": gin.H{
			"source":      item.IpConfig.Source,
			"subnet_mask": item.IpConfig.SubnetMask,
		},
		"header_config": gin.H{
			"header_name":    item.HeaderConfig.HeaderName,
			"operator":       item.HeaderConfig.Operator,
			"header_value":   item.HeaderConfig.HeaderValue,
			"case_sensitive": item.HeaderConfig.CaseSensitive,
		},
		"path_config": gin.H{
			"path":       item.PathConfig.Path,
			"match_type": item.PathConfig.MatchType,
		},
		"rate_limit":      item.RateLimit,
		"rate_unit":       item.RateUnit,
		"burst":           item.Burst,
		"action_exceeded": item.ActionExceeded,
		"custom_response": item.CustomResponse,
		"response_code":   item.ResponseCode,
		"response_body":   item.ResponseBody,
		"log_events":      item.LogEvents,
		"add_reputation":  item.AddReputation,
		"enable_alert":    item.EnableAlert,
		"status":          item.Status,
		"created_by":      item.CreatedBy,
		"created_at":      item.CreatedAt,
		"updated_at":      item.UpdatedAt,
	})
}

// List xử lý HTTP GET /api/v1/rate-limits: Danh sách Rate Limit Rules.
func (h *RateLimitHandler) List(c *gin.Context) {
	search := c.Query("search")
	status := c.Query("status")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	q := entity.ListRateLimitRulesQuery{
		Search: search,
		Status: status,
		Limit:  limit,
		Offset: offset,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitQueryTimeout)
	defer cancel()

	res, err := h.service.ListRateLimitRules(ctx, q)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Truy vấn danh sách rate limit rules đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := make([]gin.H, 0, len(res.Items))
	for _, it := range res.Items {
		items = append(items, gin.H{
			"id":                 it.ID,
			"name":               it.Name,
			"description":        it.Description,
			"enabled_dimensions": it.EnabledDimensions,
			"dimension_order":    it.DimensionOrder,
			"ip_config": gin.H{
				"source":      it.IpConfig.Source,
				"subnet_mask": it.IpConfig.SubnetMask,
			},
			"header_config": gin.H{
				"header_name":    it.HeaderConfig.HeaderName,
				"operator":       it.HeaderConfig.Operator,
				"header_value":   it.HeaderConfig.HeaderValue,
				"case_sensitive": it.HeaderConfig.CaseSensitive,
			},
			"path_config": gin.H{
				"path":       it.PathConfig.Path,
				"match_type": it.PathConfig.MatchType,
			},
			"rate_limit":      it.RateLimit,
			"rate_unit":       it.RateUnit,
			"burst":           it.Burst,
			"action_exceeded": it.ActionExceeded,
			"custom_response": it.CustomResponse,
			"response_code":   it.ResponseCode,
			"response_body":   it.ResponseBody,
			"log_events":      it.LogEvents,
			"add_reputation":  it.AddReputation,
			"enable_alert":    it.EnableAlert,
			"status":          it.Status,
			"created_by":      it.CreatedBy,
			"created_at":      it.CreatedAt,
			"updated_at":      it.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"items":          items,
		"total_filtered": res.TotalFiltered,
		"page":           page,
		"limit":          limit,
	})
}

// GetByID xử lý HTTP GET /api/v1/rate-limits/:id: Lấy chi tiết rule.
func (h *RateLimitHandler) GetByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID rule không hợp lệ"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitQueryTimeout)
	defer cancel()

	item, err := h.service.GetRateLimitRuleByID(ctx, id)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Truy vấn chi tiết rate limit rule đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                 item.ID,
		"name":               item.Name,
		"description":        item.Description,
		"enabled_dimensions": item.EnabledDimensions,
		"dimension_order":    item.DimensionOrder,
		"ip_config": gin.H{
			"source":      item.IpConfig.Source,
			"subnet_mask": item.IpConfig.SubnetMask,
		},
		"header_config": gin.H{
			"header_name":    item.HeaderConfig.HeaderName,
			"operator":       item.HeaderConfig.Operator,
			"header_value":   item.HeaderConfig.HeaderValue,
			"case_sensitive": item.HeaderConfig.CaseSensitive,
		},
		"path_config": gin.H{
			"path":       item.PathConfig.Path,
			"match_type": item.PathConfig.MatchType,
		},
		"rate_limit":      item.RateLimit,
		"rate_unit":       item.RateUnit,
		"burst":           item.Burst,
		"action_exceeded": item.ActionExceeded,
		"custom_response": item.CustomResponse,
		"response_code":   item.ResponseCode,
		"response_body":   item.ResponseBody,
		"log_events":      item.LogEvents,
		"add_reputation":  item.AddReputation,
		"enable_alert":    item.EnableAlert,
		"status":          item.Status,
		"created_by":      item.CreatedBy,
		"created_at":      item.CreatedAt,
		"updated_at":      item.UpdatedAt,
	})
}

// Update xử lý HTTP PUT /api/v1/rate-limits/:id: Cập nhật một Rate Limit Rule.
func (h *RateLimitHandler) Update(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID rule không hợp lệ"})
		return
	}

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.UpdateRateLimitRuleRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rule name is required"})
		return
	}
	if len(req.Name) > 120 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rule name exceeds 120 characters"})
		return
	}
	if req.RateLimit <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rate_limit must be greater than 0"})
		return
	}

	cmd := entity.UpdateRateLimitRuleCommand{
		ID:                id,
		Name:              req.Name,
		Description:       req.Description,
		EnabledDimensions: req.EnabledDimensions,
		DimensionOrder:    req.DimensionOrder,
		IpConfig: entity.RateLimitIpConfig{
			Source:     req.IpConfig.Source,
			SubnetMask: req.IpConfig.SubnetMask,
		},
		HeaderConfig: entity.RateLimitHeaderConfig{
			HeaderName:    req.HeaderConfig.HeaderName,
			Operator:      req.HeaderConfig.Operator,
			HeaderValue:   req.HeaderConfig.HeaderValue,
			CaseSensitive: req.HeaderConfig.CaseSensitive,
		},
		PathConfig: entity.RateLimitPathConfig{
			Path:      req.PathConfig.Path,
			MatchType: req.PathConfig.MatchType,
		},
		RateLimit:      req.RateLimit,
		RateUnit:       req.RateUnit,
		Burst:          req.Burst,
		ActionExceeded: req.ActionExceeded,
		CustomResponse: req.CustomResponse,
		ResponseCode:   req.ResponseCode,
		ResponseBody:   req.ResponseBody,
		LogEvents:      req.LogEvents,
		AddReputation:  req.AddReputation,
		EnableAlert:    req.EnableAlert,
		Status:         req.Status,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitChangeTimeout)
	defer cancel()

	rule, err := h.service.UpdateRateLimitRule(ctx, cmd)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Thao tác cập nhật rate limit rule đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                 rule.ID,
		"name":               rule.Name,
		"description":        rule.Description,
		"enabled_dimensions": rule.EnabledDimensions,
		"dimension_order":    rule.DimensionOrder,
		"ip_config": gin.H{
			"source":      rule.IpConfig.Source,
			"subnet_mask": rule.IpConfig.SubnetMask,
		},
		"header_config": gin.H{
			"header_name":    rule.HeaderConfig.HeaderName,
			"operator":       rule.HeaderConfig.Operator,
			"header_value":   rule.HeaderConfig.HeaderValue,
			"case_sensitive": rule.HeaderConfig.CaseSensitive,
		},
		"path_config": gin.H{
			"path":       rule.PathConfig.Path,
			"match_type": rule.PathConfig.MatchType,
		},
		"rate_limit":      rule.RateLimit,
		"rate_unit":       rule.RateUnit,
		"burst":           rule.Burst,
		"action_exceeded": rule.ActionExceeded,
		"custom_response": rule.CustomResponse,
		"response_code":   rule.ResponseCode,
		"response_body":   rule.ResponseBody,
		"log_events":      rule.LogEvents,
		"add_reputation":  rule.AddReputation,
		"enable_alert":    rule.EnableAlert,
		"status":          rule.Status,
		"created_by":      rule.CreatedBy,
		"created_at":      rule.CreatedAt,
		"updated_at":      rule.UpdatedAt,
	})
}

// Delete xử lý HTTP DELETE /api/v1/rate-limits/:id: Xóa rule.
func (h *RateLimitHandler) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID rule không hợp lệ"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitChangeTimeout)
	defer cancel()

	if err := h.service.DeleteRateLimitRule(ctx, id); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Thao tác xóa rate limit rule đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Xóa rate limit rule thành công", "id": id})
}

// GetStats xử lý HTTP GET /api/v1/rate-limits/stats: Lấy tổng hợp số liệu thống kê thực tế.
func (h *RateLimitHandler) GetStats(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitQueryTimeout)
	defer cancel()

	summary, err := h.service.GetStats(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Truy vấn thống kê rate limit đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"mode":                 summary.Mode,
		"enabled":              summary.Mode != "disabled",
		"total_hits":           summary.TotalHits,
		"total_blocked":        summary.TotalBlocked,
		"total_throttled":      summary.TotalThrottled,
		"avg_latency_ms":       summary.AvgLatencyMs,
		"hits_change_pct":      summary.HitsChangePct,
		"blocked_change_pct":   summary.BlockedChangePct,
		"throttled_change_pct": summary.ThrottledChangePct,
		"latency_change_pct":   summary.LatencyChangePct,
	})
}

// GetMetrics xử lý HTTP GET /api/v1/rate-limits/metrics: Lấy chuỗi thời gian biểu đồ và top endpoints.
func (h *RateLimitHandler) GetMetrics(c *gin.Context) {
	timeRange := c.Query("range")
	if timeRange == "" {
		timeRange = "24h"
	}
	sortBy := c.Query("sort")
	if sortBy == "" {
		sortBy = "blocked"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitQueryTimeout)
	defer cancel()

	res, err := h.service.GetMetrics(ctx, timeRange, sortBy)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Truy vấn metrics rate limit đã hết thời gian chờ"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	velocity := make([]gin.H, 0, len(res.VelocitySeries))
	for _, v := range res.VelocitySeries {
		velocity = append(velocity, gin.H{
			"timestamp":       v.Timestamp,
			"total_hits":      v.TotalHits,
			"blocked_count":   v.BlockedCount,
			"throttled_count": v.ThrottledCount,
		})
	}

	endpoints := make([]gin.H, 0, len(res.TopEndpoints))
	for _, ep := range res.TopEndpoints {
		endpoints = append(endpoints, gin.H{
			"endpoint":    ep.Endpoint,
			"method":      ep.Method,
			"rule_name":   ep.RuleName,
			"requests":    ep.Requests,
			"blocked":     ep.Blocked,
			"block_ratio": ep.BlockRatio,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"mode":            res.Mode,
		"enabled":         res.Mode != "disabled",
		"range":           timeRange,
		"sort":            sortBy,
		"velocity_series": velocity,
		"top_endpoints":   endpoints,
	})
}

// Flush xử lý HTTP POST /api/v1/rate-limits/flush: Flush dữ liệu metrics từ RAM buffer xuống CSDL SQLite.
func (h *RateLimitHandler) Flush(c *gin.Context) {
	if h.collector != nil {
		ctx, cancel := context.WithTimeout(c.Request.Context(), rateLimitQueryTimeout)
		defer cancel()
		h.collector.Flush(ctx)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Rate limit metrics flushed"})
}

// EnableCollector xử lý HTTP POST /api/v1/rate-limits/enable: Bật tính năng thu thập metrics của collector.
func (h *RateLimitHandler) EnableCollector(c *gin.Context) {
	if h.collector != nil {
		h.collector.SetEnabled(true)
	}
	c.JSON(http.StatusOK, gin.H{"enabled": true})
}

// DisableCollector xử lý HTTP POST /api/v1/rate-limits/disable: Tắt tính năng thu thập metrics của collector.
func (h *RateLimitHandler) DisableCollector(c *gin.Context) {
	if h.collector != nil {
		h.collector.SetEnabled(false)
	}
	c.JSON(http.StatusOK, gin.H{"enabled": false})
}
