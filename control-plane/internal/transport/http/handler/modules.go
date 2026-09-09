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
		c.JSON(500, gin.H{"error": e.Error()})
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

// AppendLog receives incremental log chunks and stage progress from a node agent during module installation.
func (h *ModuleStoreHandler) AppendLog(c *gin.Context) {
	nodeID := c.Param("node")
	idStr := c.Param("id")
	jobID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || jobID <= 0 || nodeID == "" {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	var req dto.AppendModuleJobLogRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	if err := c.ShouldBindJSON(&req); err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesMutationTimeout)
	defer cancel()

	err = h.service.AppendJobLog(ctx, entity.AppendModuleJobLogCommand{
		NodeID:   nodeID,
		JobID:    jobID,
		Stage:    req.Stage,
		Progress: req.Progress,
		Message:  req.Message,
		LogChunk: req.LogChunk,
	})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}

// JobEventsStream streams real-time logs, progress and state updates for a specific module job via Server-Sent Events (SSE).
func (h *ModuleStoreHandler) JobEventsStream(c *gin.Context) {
	idStr := c.Param("id")
	jobID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || jobID <= 0 {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	// Gửi snapshot ban đầu của Job (nếu đã có)
	ctxQuery, cancelQuery := context.WithTimeout(c.Request.Context(), modulesQueryTimeout)
	initLog, err := h.service.GetJobLogs(ctxQuery, entity.ModuleJobLogsQuery{JobID: jobID})
	cancelQuery()

	if err == nil && initLog != nil {
		progress := 10
		switch initLog.State {
		case "succeeded":
			progress = 100
		case "failed":
			progress = 0
		}
		c.SSEvent("init", gin.H{
			"job_id":   initLog.ID,
			"node_id":  initLog.NodeID,
			"action":   initLog.Action,
			"state":    initLog.State,
			"message":  initLog.Message,
			"logs":     initLog.Logs,
			"progress": progress,
		})
		c.Writer.Flush()

		// Nếu job đã xong trước khi client kết nối thì kết thúc stream luôn
		if initLog.State == "succeeded" || initLog.State == "failed" {
			return
		}
	}

	eventChan, unsubscribe := h.service.SubscribeJobEvents()
	defer unsubscribe()

	keepAliveTicker := time.NewTicker(15 * time.Second)
	defer keepAliveTicker.Stop()

	clientDone := c.Request.Context().Done()

	for {
		select {
		case <-clientDone:
			return
		case <-keepAliveTicker.C:
			c.SSEvent("ping", gin.H{"status": "keepalive"})
			c.Writer.Flush()
		case msg, ok := <-eventChan:
			if !ok {
				return
			}
			if msg.Event == "module_job_progress" {
				if ev, ok := msg.Data.(entity.ModuleJobProgressEvent); ok && ev.JobID == jobID {
					c.SSEvent("progress", gin.H{
						"job_id":    ev.JobID,
						"node_id":   ev.NodeID,
						"stage":     ev.Stage,
						"progress":  ev.Progress,
						"message":   ev.Message,
						"log_chunk": ev.LogChunk,
						"state":     ev.State,
					})
					c.Writer.Flush()

					if ev.State == "succeeded" || ev.State == "failed" {
						return
					}
				}
			}
		}
	}
}

// GetSyncOverview trả về tổng quan trạng thái đồng bộ giữa Desired State và Actual State của các module.
func (h *ModuleStoreHandler) GetSyncOverview(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesQueryTimeout)
	defer cancel()

	overview, err := h.service.GetSyncOverview(ctx, entity.GetModuleSyncOverviewQuery{})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get sync overview timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	res := make([]gin.H, len(overview))
	for i, item := range overview {
		res[i] = gin.H{
			"name":          item.Name,
			"desired":       item.Desired,
			"actual_loaded": item.ActualLoaded,
			"total_nodes":   item.TotalNodes,
			"sync_status":   item.SyncStatus,
			"feature_ready": item.FeatureReady,
			"pending_jobs":  item.PendingJobs,
		}
	}
	c.JSON(http.StatusOK, res)
}

// SetDesired thiết lập trạng thái mong muốn (fleet-wide generic) cho một module.
func (h *ModuleStoreHandler) SetDesired(c *gin.Context) {
	if c.GetString(middleware.CtxUserRoleKey) != "admin" {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	name := c.Param("name")
	if name == "" {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	var req dto.SetModuleDesiredRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	if err := c.ShouldBindJSON(&req); err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesMutationTimeout)
	defer cancel()

	err := h.service.SetDesiredState(ctx, entity.SetModuleDesiredCommand{
		Name:    name,
		Enabled: req.Enabled,
		Actor:   c.GetString(middleware.CtxUserIDKey),
	})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":  "ok",
		"module":  name,
		"enabled": req.Enabled,
	})
}

// TriggerSync kích hoạt fanout reconciliation để đồng bộ các node bị drift về desired state.
func (h *ModuleStoreHandler) TriggerSync(c *gin.Context) {
	if c.GetString(middleware.CtxUserRoleKey) != "admin" {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	var req dto.TriggerModuleSyncRequest
	if c.Request.ContentLength > 0 {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		_ = c.ShouldBindJSON(&req)
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), modulesMutationTimeout)
	defer cancel()

	res, err := h.service.Sync(ctx, entity.TriggerModuleSyncCommand{
		Name:  req.Module,
		Actor: c.GetString(middleware.CtxUserIDKey),
	})
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"queued_jobs": res.QueuedJobs,
		"node_ids":    res.NodeIDs,
	})
}
