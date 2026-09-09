package handler

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

const (
	modulesQueryTimeout    = 5 * time.Second  // Dành cho List, Poll và GetJobLogs truy vấn SQLite
	modulesMutationTimeout = 10 * time.Second // Dành cho Queue công việc và Report kết quả
)

// ModuleStoreHandler manages NGINX modules and installation/maintenance jobs across cluster nodes.
type ModuleStoreHandler struct {
	service port.ModuleStoreService
}

// NewModuleStoreHandler creates a new ModuleStoreHandler instance.
func NewModuleStoreHandler(s port.ModuleStoreService) *ModuleStoreHandler {
	return &ModuleStoreHandler{service: s}
}

// List returns module availability and loaded status across cluster nodes.
func (h *ModuleStoreHandler) List(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesQueryTimeout)
	defer cancel()

	out, e := h.service.List(ctx, entity.ListModulesQuery{})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "list modules query timed out"})
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
			"job_logs":      node.JobLogs,
		}
	}

	c.JSON(200, res)
}

// Queue enqueues a module installation, removal, or check job for a specific node (admin only).
func (h *ModuleStoreHandler) Queue(c *gin.Context) {
	if c.GetString(middleware.CtxUserRoleKey) != "admin" {
		c.AbortWithStatus(403)
		return
	}
	var req dto.QueueModuleJobRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesMutationTimeout)
	defer cancel()

	out, e := h.service.Queue(ctx, entity.QueueModuleJobCommand{
		NodeID: c.Param("node"),
		Action: req.Action,
		Actor:  c.GetString(middleware.CtxUserIDKey),
	})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "queue module job timed out"})
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

// Poll allows a node to poll for pending module jobs.
func (h *ModuleStoreHandler) Poll(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesQueryTimeout)
	defer cancel()

	out, e := h.service.Poll(ctx, entity.PollModuleJobQuery{NodeID: c.Param("node")})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "poll module job timed out"})
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

// Report receives node module status and job execution results with logs.
func (h *ModuleStoreHandler) Report(c *gin.Context) {
	var req dto.ReportModuleRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 131072)
	if c.ShouldBindJSON(&req) != nil {
		c.AbortWithStatus(400)
		return
	}

	mods := make([]entity.ReportModuleItem, len(req.Modules))
	for i, m := range req.Modules {
		mods[i] = entity.ReportModuleItem{
			Name:      m.Name,
			Available: m.Available,
			Loaded:    m.Loaded,
			Source:    m.Source,
		}
	}

	cmd := entity.ReportModuleCommand{
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
		JobLogs:      req.JobLogs,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesMutationTimeout)
	defer cancel()

	if e := h.service.Report(ctx, cmd); e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "report modules timed out"})
			return
		}
		c.JSON(422, gin.H{"error": e.Error()})
		return
	}
	c.Status(204)
}

// GetJobLogs returns execution logs and status of a specific module job.
func (h *ModuleStoreHandler) GetJobLogs(c *gin.Context) {
	idStr := c.Param("id")
	jobID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || jobID <= 0 {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesQueryTimeout)
	defer cancel()

	logs, err := h.service.GetJobLogs(ctx, entity.ModuleJobLogsQuery{JobID: jobID})
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
			return
		}
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get job logs timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":         logs.ID,
		"node_id":    logs.NodeID,
		"action":     logs.Action,
		"state":      logs.State,
		"message":    logs.Message,
		"logs":       logs.Logs,
		"created_at": logs.CreatedAt,
		"updated_at": logs.UpdatedAt,
	})
}
