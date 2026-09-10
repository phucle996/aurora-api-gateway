package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

var (
	validHostRegex = regexp.MustCompile(`^(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$|^\*$|^localhost$`)
)

const (
	routeQueryTimeout  = 5 * time.Second
	routeActionTimeout = 10 * time.Second
)

// RouteHandler quản lý các HTTP endpoints của Routing workflow.
type RouteHandler struct {
	service port.RoutingService
}

func NewRouteHandler(service port.RoutingService) *RouteHandler {
	return &RouteHandler{
		service: service,
	}
}

// List trả về danh sách Route kèm phân trang và tìm kiếm.
func (h *RouteHandler) List(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), routeQueryTimeout)
	defer cancel()

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	q := entity.ListRoutesQuery{
		Search:       strings.TrimSpace(c.Query("search")),
		Host:         strings.TrimSpace(c.Query("host")),
		UpstreamName: strings.TrimSpace(c.Query("upstream_name")),
		Limit:        limit,
		Offset:       offset,
	}

	result, err := h.service.ListRoutes(ctx, q)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "list routes timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := make([]dto.RouteResponse, len(result.Items))
	for i, it := range result.Items {
		items[i] = dto.ToRouteResponse(it)
	}

	c.JSON(http.StatusOK, dto.ListRoutesResponse{
		Items: items,
		Total: result.Total,
	})
}

// GetByID trả về chi tiết của một Route.
func (h *RouteHandler) GetByID(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), routeQueryTimeout)
	defer cancel()

	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id không được để trống"})
		return
	}

	item, err := h.service.GetRouteByID(ctx, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "route not found"})
		return
	}

	c.JSON(http.StatusOK, dto.ToRouteResponse(*item))
}

// Create tạo mới một Route.
func (h *RouteHandler) Create(c *gin.Context) {
	var req dto.CreateRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tên route không được để trống"})
		return
	}

	host := strings.ToLower(strings.TrimSpace(req.Host))
	if host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "host/domain không được để trống"})
		return
	}
	if host != "*" && !validHostRegex.MatchString(host) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "host/domain không hợp lệ (ví dụ: api.example.com, *.example.com, hoặc *)"})
		return
	}

	path := strings.TrimSpace(req.Path)
	if path == "" || !strings.HasPrefix(path, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path phải bắt đầu bằng ký tự '/' (ví dụ: / hoặc /api/v1)"})
		return
	}

	upstreamName := strings.TrimSpace(req.UpstreamName)
	if upstreamName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upstream_name không được để trống"})
		return
	}

	pluginsJSON := strings.TrimSpace(req.PluginsJSON)
	if pluginsJSON != "" {
		if !json.Valid([]byte(pluginsJSON)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "plugins_json không phải định dạng JSON hợp lệ"})
			return
		}
	} else {
		pluginsJSON = "{}"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), routeActionTimeout)
	defer cancel()

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	cmd := entity.CreateRouteCommand{
		Name:         name,
		Host:         host,
		Path:         path,
		UpstreamName: upstreamName,
		Enabled:      enabled,
		StripPath:    req.StripPath,
		WebSocket:    req.WebSocket,
		Priority:     req.Priority,
		PluginsJSON:  pluginsJSON,
		Description:  strings.TrimSpace(req.Description),
	}

	created, err := h.service.CreateRoute(ctx, cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, dto.ToRouteResponse(*created))
}

// Update cập nhật cấu hình Route.
func (h *RouteHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id không được để trống"})
		return
	}

	var req dto.UpdateRouteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tên route không được để trống"})
		return
	}

	host := strings.ToLower(strings.TrimSpace(req.Host))
	if host == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "host/domain không được để trống"})
		return
	}
	if host != "*" && !validHostRegex.MatchString(host) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "host/domain không hợp lệ (ví dụ: api.example.com, *.example.com, hoặc *)"})
		return
	}

	path := strings.TrimSpace(req.Path)
	if path == "" || !strings.HasPrefix(path, "/") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path phải bắt đầu bằng ký tự '/' (ví dụ: / hoặc /api/v1)"})
		return
	}

	upstreamName := strings.TrimSpace(req.UpstreamName)
	if upstreamName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upstream_name không được để trống"})
		return
	}

	pluginsJSON := strings.TrimSpace(req.PluginsJSON)
	if pluginsJSON != "" {
		if !json.Valid([]byte(pluginsJSON)) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "plugins_json không phải định dạng JSON hợp lệ"})
			return
		}
	} else {
		pluginsJSON = "{}"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), routeActionTimeout)
	defer cancel()

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	cmd := entity.UpdateRouteCommand{
		ID:           id,
		Name:         name,
		Host:         host,
		Path:         path,
		UpstreamName: upstreamName,
		Enabled:      enabled,
		StripPath:    req.StripPath,
		WebSocket:    req.WebSocket,
		Priority:     req.Priority,
		PluginsJSON:  pluginsJSON,
		Description:  strings.TrimSpace(req.Description),
	}

	updated, err := h.service.UpdateRoute(ctx, cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToRouteResponse(*updated))
}

// Delete xóa Route.
func (h *RouteHandler) Delete(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), routeActionTimeout)
	defer cancel()

	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id không được để trống"})
		return
	}

	if err := h.service.DeleteRoute(ctx, id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "route deleted successfully"})
}

// ToggleStatus bật/tắt nhanh Route.
func (h *RouteHandler) ToggleStatus(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id không được để trống"})
		return
	}

	var req dto.ToggleRouteStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), routeActionTimeout)
	defer cancel()

	if err := h.service.ToggleRouteStatus(ctx, id, req.Enabled); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "route status updated", "enabled": req.Enabled})
}
