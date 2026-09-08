package handler

import (
	"net/http"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

type DependenciesHandler struct {
	list   port.ListDependenciesService
	queue  port.QueueDependencyService
	poll   port.PollDependencyService
	report port.ReportDependencyService
}

func NewDependenciesHandler(l port.ListDependenciesService, q port.QueueDependencyService, p port.PollDependencyService, r port.ReportDependencyService) *DependenciesHandler {
	return &DependenciesHandler{l, q, p, r}
}

func (h *DependenciesHandler) List(c *gin.Context) {
	out, e := h.list.List(c.Request.Context(), entity.ListDependenciesQuery{})
	if e != nil {
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
	out, e := h.queue.Queue(c.Request.Context(), entity.QueueDependencyCommand{NodeID: c.Param("node"), Action: req.Action, Actor: c.GetString(middleware.CtxUserIDKey)})
	if e != nil {
		c.JSON(422, gin.H{"error": e.Error()})
		return
	}
	c.JSON(202, gin.H{
		"id":     out.ID,
		"action": out.Action,
		"state":  out.State,
	})
}

func (h *DependenciesHandler) Poll(c *gin.Context) {
	out, e := h.poll.Poll(c.Request.Context(), entity.PollDependencyQuery{NodeID: c.Param("node")})
	if e != nil {
		c.AbortWithStatus(500)
		return
	}
	c.JSON(200, gin.H{
		"id":     out.ID,
		"action": out.Action,
	})
}

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

	if e := h.report.Report(c.Request.Context(), cmd); e != nil {
		c.JSON(422, gin.H{"error": e.Error()})
		return
	}
	c.Status(204)
}
