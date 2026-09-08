package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

// Thời gian chờ tối đa cho các tác vụ quản lý phụ thuộc (NGINX Dependencies)
const (
	dependenciesQueryTimeout    = 5 * time.Second  // Dành cho List và Poll truy vấn SQLite
	dependenciesMutationTimeout = 10 * time.Second // Dành cho Queue công việc và Report kết quả
)

// DependenciesHandler xử lý các API kiểm tra module NGINX phụ thuộc (Brotli, GeoIP2...) và điều phối cài đặt trên worker nodes.
type DependenciesHandler struct {
	service port.DependenciesService
}

// NewDependenciesHandler khởi tạo handler với DependenciesService.
func NewDependenciesHandler(s port.DependenciesService) *DependenciesHandler {
	return &DependenciesHandler{service: s}
}

// List xử lý HTTP GET /api/v1/settings/dependencies:
// Trả về danh sách trạng thái các module NGINX đã nạp hoặc có sẵn trên từng node trong cluster.
func (h *DependenciesHandler) List(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), dependenciesQueryTimeout)
	defer cancel()

	out, e := h.service.List(ctx, entity.ListDependenciesQuery{})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Truy vấn danh sách phụ thuộc đã hết thời gian chờ"})
			return
		}
		c.AbortWithStatus(500)
		return
	}

	res := make([]gin.H, len(out))
	for i, node := range out {
		mods := make([]gin.H, len(node.Modules))
		for j, m := range node.Modules {
			mods[j] = gin.H{
				"name":      m.Name,
				"available": m.Available,
				"loaded":    m.Loaded,
				"source":    m.Source,
			}
		}
		res[i] = gin.H{
			"node_id":       node.NodeID,
			"checked_at":    node.CheckedAt,
			"nginx_version": node.NginxVersion,
			"architecture":  node.Architecture,
			"modules":       mods,
			"installable":   node.Installable,
			"error":         node.Error,
			"fresh":         node.Fresh,
			"job_id":        node.JobID,
			"job_action":    node.JobAction,
			"job_state":     node.JobState,
			"job_message":   node.JobMessage,
		}
	}

	c.JSON(200, res)
}

// Queue xử lý HTTP POST /api/v1/settings/dependencies/:node/jobs:
// Yêu cầu quyền admin để đưa lệnh cài đặt/gỡ bỏ module NGINX vào hàng đợi thực thi của node.
func (h *DependenciesHandler) Queue(c *gin.Context) {
	if c.GetString(middleware.CtxUserRoleKey) != "admin" {
		c.AbortWithStatus(403)
		return
	}
	var req dto.QueueDependencyRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), dependenciesMutationTimeout)
	defer cancel()

	out, e := h.service.Queue(ctx, entity.QueueDependencyCommand{
		NodeID: c.Param("node"),
		Action: req.Action,
		Actor:  c.GetString(middleware.CtxUserIDKey),
	})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Tạo tác vụ cài đặt phụ thuộc đã hết thời gian chờ"})
			return
		}
		c.JSON(422, gin.H{"error": e.Error()})
		return
	}
	c.JSON(202, gin.H{
		"id":     out.ID,
		"action": out.Action,
		"state":  out.State,
	})
}

// Poll xử lý HTTP GET /api/v1/settings/dependencies/:node/poll:
// Endpoint cho node định kỳ thăm dò (poll) công việc cài đặt module đang chờ xử lý.
func (h *DependenciesHandler) Poll(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), dependenciesQueryTimeout)
	defer cancel()

	out, e := h.service.Poll(ctx, entity.PollDependencyQuery{NodeID: c.Param("node")})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Thăm dò công việc phụ thuộc đã hết thời gian chờ"})
			return
		}
		c.AbortWithStatus(500)
		return
	}
	c.JSON(200, gin.H{
		"id":     out.ID,
		"action": out.Action,
	})
}

// Report xử lý HTTP POST /api/v1/settings/dependencies/:node/report:
// Node báo cáo kết quả kiểm tra module hoặc trạng thái hoàn thành của job cài đặt.
func (h *DependenciesHandler) Report(c *gin.Context) {
	var req dto.ReportDependencyRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}

	mods := make([]entity.ReportDependencyModule, len(req.Modules))
	for i, m := range req.Modules {
		mods[i] = entity.ReportDependencyModule{
			Name:      m.Name,
			Available: m.Available,
			Loaded:    m.Loaded,
			Source:    m.Source,
		}
	}

	cmd := entity.ReportDependencyCommand{
		NodeID:       c.Param("node"),
		CheckedAt:    req.CheckedAt,
		NginxVersion: req.NginxVersion,
		Architecture: req.Architecture,
		Modules:      mods,
		Installable:  req.Installable,
		Error:        req.Error,
		JobID:        req.JobID,
		JobState:     req.JobState,
		JobMessage:   req.JobMessage,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), dependenciesMutationTimeout)
	defer cancel()

	if e := h.service.Report(ctx, cmd); e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "Báo cáo phụ thuộc đã hết thời gian chờ"})
			return
		}
		c.JSON(422, gin.H{"error": e.Error()})
		return
	}
	c.Status(204)
}
