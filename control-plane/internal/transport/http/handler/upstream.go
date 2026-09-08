package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// UpstreamHandler bao đóng các HTTP endpoint cho Upstream workflow.
type UpstreamHandler struct {
	service port.UpstreamService
}

// NewUpstreamHandler khởi tạo handler với UpstreamService.
func NewUpstreamHandler(s port.UpstreamService) *UpstreamHandler {
	return &UpstreamHandler{service: s}
}

// Create xử lý HTTP POST /api/v1/upstreams: Tạo mới một Upstream Pool.
func (h *UpstreamHandler) Create(c *gin.Context) {
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 262144)
	var req dto.CreateUpstreamRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 256KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu yêu cầu không hợp lệ: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Tên upstream pool không được để trống"})
		return
	}

	cmd := entity.CreateUpstreamCommand{
		Name:             req.Name,
		Description:      req.Description,
		ArchitectureType: req.ArchitectureType,
		Algorithm:        req.Algorithm,
		Servers:          req.Servers,
		ExternalFQDN:     req.ExternalFQDN,
		SNIOverride:      req.SNIOverride,
		DynamicDNS:       req.DynamicDNS,
		InternalSSL:      req.InternalSSL,
		Probes:           req.Probes,
		Transport:        req.Transport,
	}

	item, err := h.service.CreateUpstream(c.Request.Context(), cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item.InternalSSL.ClientKeyConfigured = item.InternalSSL.ClientKey != ""
	item.InternalSSL.ClientKey = ""
	c.JSON(http.StatusCreated, item)
}

// Update xử lý HTTP PUT /api/v1/upstreams/:id: Cập nhật Upstream Pool đã có.
func (h *UpstreamHandler) Update(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID upstream không hợp lệ"})
		return
	}

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 262144)
	var req dto.UpdateUpstreamRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 256KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu cập nhật upstream không hợp lệ: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	cmd := entity.UpdateUpstreamCommand{
		ID:               id,
		Name:             req.Name,
		Description:      req.Description,
		ArchitectureType: req.ArchitectureType,
		Algorithm:        req.Algorithm,
		Servers:          req.Servers,
		ExternalFQDN:     req.ExternalFQDN,
		SNIOverride:      req.SNIOverride,
		DynamicDNS:       req.DynamicDNS,
		InternalSSL:      req.InternalSSL,
		Probes:           req.Probes,
		Transport:        req.Transport,
	}

	item, err := h.service.UpdateUpstream(c.Request.Context(), cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item.InternalSSL.ClientKeyConfigured = item.InternalSSL.ClientKey != ""
	item.InternalSSL.ClientKey = ""
	c.JSON(http.StatusOK, item)
}

// List xử lý HTTP GET /api/v1/upstreams: Lấy danh sách upstream pools.
func (h *UpstreamHandler) List(c *gin.Context) {
	search := c.Query("search")
	archType := c.Query("type")

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

	query := entity.ListUpstreamsQuery{
		Search:           search,
		ArchitectureType: archType,
		Limit:            limit,
		Offset:           offset,
	}

	items, total, err := h.service.ListUpstreams(c.Request.Context(), query)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy vấn danh sách upstream: " + err.Error()})
		return
	}

	for i := range items {
		items[i].InternalSSL.ClientKeyConfigured = items[i].InternalSSL.ClientKey != ""
		items[i].InternalSSL.ClientKey = ""
	}
	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// GetByID xử lý HTTP GET /api/v1/upstreams/:id: Lấy chi tiết upstream theo ID.
func (h *UpstreamHandler) GetByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID upstream không hợp lệ"})
		return
	}

	item, err := h.service.GetUpstream(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi truy vấn upstream: " + err.Error()})
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Không tìm thấy upstream"})
		return
	}

	item.InternalSSL.ClientKeyConfigured = item.InternalSSL.ClientKey != ""
	item.InternalSSL.ClientKey = ""
	c.JSON(http.StatusOK, item)
}

// Delete xử lý HTTP DELETE /api/v1/upstreams/:id: Xóa một Upstream Pool.
func (h *UpstreamHandler) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ID upstream không hợp lệ"})
		return
	}

	if err := h.service.DeleteUpstream(c.Request.Context(), id); err != nil {
		if strings.Contains(err.Error(), "still referenced by domains") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if strings.Contains(err.Error(), "không tồn tại") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi xóa upstream: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": id})
}

// Desired xử lý HTTP GET /api/v1/upstream-sync/:node:
// Trả về cấu hình snapshot upstreams mới nhất kèm SHA-256 digest và nội dung NGINX config cho node.
func (h *UpstreamHandler) Desired(c *gin.Context) {
	nodeID := c.Param("node")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Node ID không được để trống"})
		return
	}

	snapshot, err := h.service.GetDesiredSnapshot(c.Request.Context(), nodeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi lấy cấu hình upstream mong muốn: " + err.Error()})
		return
	}

	for i := range snapshot.Upstreams {
		snapshot.Upstreams[i].InternalSSL.ClientKeyConfigured = snapshot.Upstreams[i].InternalSSL.ClientKey != ""
		snapshot.Upstreams[i].InternalSSL.ClientKey = ""
	}
	c.JSON(http.StatusOK, snapshot)
}

// Report xử lý HTTP POST /api/v1/upstream-sync/:node:
// Tiếp nhận phản hồi từ NGINX node sau khi hot-swap và reload thành công hoặc thất bại.
func (h *UpstreamHandler) Report(c *gin.Context) {
	nodeID := c.Param("node")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Node ID không được để trống"})
		return
	}

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.UpstreamSyncReportRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Dữ liệu báo cáo không hợp lệ: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	err := h.service.ReportSyncStatus(c.Request.Context(), nodeID, req.ReleaseID, req.Phase, req.Message)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Lỗi ghi nhận báo cáo đồng bộ: " + err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}
