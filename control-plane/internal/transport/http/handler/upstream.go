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
		Servers:          toEntityServers(req.Servers),
		ExternalFQDN:     req.ExternalFQDN,
		SNIOverride:      req.SNIOverride,
		DynamicDNS:       req.DynamicDNS,
		InternalSSL:      toEntityInternalSSL(req.InternalSSL),
		Probes:           toEntityProbes(req.Probes),
		Transport:        toEntityTransport(req.Transport),
	}

	item, err := h.service.CreateUpstream(c.Request.Context(), cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, upstreamToGinH(item))
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
		Servers:          toEntityServers(req.Servers),
		ExternalFQDN:     req.ExternalFQDN,
		SNIOverride:      req.SNIOverride,
		DynamicDNS:       req.DynamicDNS,
		InternalSSL:      toEntityInternalSSL(req.InternalSSL),
		Probes:           toEntityProbes(req.Probes),
		Transport:        toEntityTransport(req.Transport),
	}

	item, err := h.service.UpdateUpstream(c.Request.Context(), cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, upstreamToGinH(item))
}

// List xử lý HTTP GET /api/v1/upstreams: Lấy danh sách upstream pools dưới dạng gin.H inline.
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

	listItems := make([]gin.H, len(items))
	for i := range items {
		listItems[i] = upstreamToGinH(&items[i])
	}

	c.JSON(http.StatusOK, gin.H{
		"items": listItems,
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

	c.JSON(http.StatusOK, upstreamToGinH(item))
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

	upstreams := make([]gin.H, len(snapshot.Upstreams))
	for i := range snapshot.Upstreams {
		upstreams[i] = upstreamToGinH(&snapshot.Upstreams[i])
	}

	c.JSON(http.StatusOK, gin.H{
		"release_id":     snapshot.ReleaseID,
		"digest":         snapshot.Digest,
		"upstreams":      upstreams,
		"config_content": snapshot.ConfigContent,
	})
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

// --- Mapping helpers chuyển đổi từ request DTO sang entity và từ entity sang gin.H ---

func toEntityServers(dtos []dto.UpstreamNodeRequest) []entity.UpstreamNode {
	if dtos == nil {
		return []entity.UpstreamNode{}
	}
	res := make([]entity.UpstreamNode, len(dtos))
	for i, d := range dtos {
		res[i] = entity.UpstreamNode{
			ID:          d.ID,
			Address:     d.Address,
			Weight:      d.Weight,
			MaxFails:    d.MaxFails,
			FailTimeout: d.FailTimeout,
			Backup:      d.Backup,
			Healthy:     d.Healthy,
		}
	}
	return res
}

func toEntityInternalSSL(d dto.UpstreamInternalSSLRequest) entity.UpstreamInternalSSL {
	return entity.UpstreamInternalSSL{
		Enabled:             d.Enabled,
		VerifyCert:          d.VerifyCert,
		SNIHost:             d.SNIHost,
		CACert:              d.CACert,
		MTLS:                d.MTLS,
		ClientCertName:      d.ClientCertName,
		ClientCert:          d.ClientCert,
		ClientKey:           d.ClientKey,
		ClientKeyConfigured: d.ClientKeyConfigured,
	}
}

func toEntityProbes(dtos []dto.UpstreamProbeRequest) []entity.UpstreamProbe {
	if dtos == nil {
		return []entity.UpstreamProbe{}
	}
	res := make([]entity.UpstreamProbe, len(dtos))
	for i, d := range dtos {
		res[i] = entity.UpstreamProbe{
			ID:             d.ID,
			Type:           d.Type,
			Path:           d.Path,
			ExpectedStatus: d.ExpectedStatus,
			IntervalSec:    d.IntervalSec,
			TimeoutSec:     d.TimeoutSec,
		}
	}
	return res
}

func toEntityTransport(d dto.UpstreamTransportRequest) entity.UpstreamTransport {
	return entity.UpstreamTransport{
		RequestCompression:   d.RequestCompression,
		CompressionMinBytes:  d.CompressionMinBytes,
		CompressionLevel:     d.CompressionLevel,
		HTTPVersion:          d.HTTPVersion,
		EnableWebSocket:      d.EnableWebSocket,
		EnableSSE:            d.EnableSSE,
		EnableGRPC:           d.EnableGRPC,
		KeepAliveConnections: d.KeepAliveConnections,
		KeepAliveTimeout:     d.KeepAliveTimeout,
	}
}

func upstreamToGinH(item *entity.UpstreamItem) gin.H {
	if item == nil {
		return gin.H{}
	}

	servers := make([]gin.H, len(item.Servers))
	for i, s := range item.Servers {
		srv := gin.H{
			"id":      s.ID,
			"address": s.Address,
			"weight":  s.Weight,
			"healthy": s.Healthy,
		}
		if s.MaxFails > 0 {
			srv["maxFails"] = s.MaxFails
		}
		if s.FailTimeout != "" {
			srv["failTimeout"] = s.FailTimeout
		}
		if s.Backup {
			srv["backup"] = s.Backup
		}
		servers[i] = srv
	}

	probes := make([]gin.H, len(item.Probes))
	for i, p := range item.Probes {
		pr := gin.H{
			"id":             p.ID,
			"type":           p.Type,
			"path":           p.Path,
			"expectedStatus": p.ExpectedStatus,
		}
		if p.IntervalSec > 0 {
			pr["intervalSec"] = p.IntervalSec
		}
		if p.TimeoutSec > 0 {
			pr["timeoutSec"] = p.TimeoutSec
		}
		probes[i] = pr
	}

	ssl := gin.H{
		"enabled":             item.InternalSSL.Enabled,
		"verifyCert":          item.InternalSSL.VerifyCert,
		"mTLS":                item.InternalSSL.MTLS,
		"clientKeyConfigured": item.InternalSSL.ClientKey != "" || item.InternalSSL.ClientKeyConfigured,
	}
	if item.InternalSSL.SNIHost != "" {
		ssl["sniHost"] = item.InternalSSL.SNIHost
	}
	if item.InternalSSL.CACert != "" {
		ssl["caCert"] = item.InternalSSL.CACert
	}
	if item.InternalSSL.ClientCertName != "" {
		ssl["clientCertName"] = item.InternalSSL.ClientCertName
	}
	if item.InternalSSL.ClientCert != "" {
		ssl["clientCert"] = item.InternalSSL.ClientCert
	}

	transport := gin.H{
		"requestCompression":  item.Transport.RequestCompression,
		"compressionMinBytes": item.Transport.CompressionMinBytes,
		"compressionLevel":    item.Transport.CompressionLevel,
		"httpVersion":         item.Transport.HTTPVersion,
		"enableWebSocket":     item.Transport.EnableWebSocket,
		"enableSse":           item.Transport.EnableSSE,
		"enableGrpc":          item.Transport.EnableGRPC,
	}
	if item.Transport.KeepAliveConnections > 0 {
		transport["keepAliveConnections"] = item.Transport.KeepAliveConnections
	}
	if item.Transport.KeepAliveTimeout > 0 {
		transport["keepAliveTimeout"] = item.Transport.KeepAliveTimeout
	}

	res := gin.H{
		"id":                  item.ID,
		"name":                item.Name,
		"description":         item.Description,
		"architecture_type":   item.ArchitectureType,
		"algorithm":           item.Algorithm,
		"servers":             servers,
		"sni_override":        item.SNIOverride,
		"dynamic_dns":         item.DynamicDNS,
		"internal_ssl":        ssl,
		"probes":              probes,
		"transport":           transport,
		"version":             item.Version,
		"bound_domains_count": item.BoundDomainsCount,
		"created_at":          item.CreatedAt,
		"updated_at":          item.UpdatedAt,
	}
	if item.ExternalFQDN != "" {
		res["external_fqdn"] = item.ExternalFQDN
	}
	return res
}
