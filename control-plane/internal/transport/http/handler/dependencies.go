package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
	"net/http"
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
	c.JSON(200, out)
}
func (h *DependenciesHandler) Queue(c *gin.Context) {
	if c.GetString(middleware.CtxUserRoleKey) != "admin" {
		c.AbortWithStatus(403)
		return
	}
	var body struct {
		Action string `json:"action"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	if c.ShouldBindJSON(&body) != nil {
		c.AbortWithStatus(400)
		return
	}
	out, e := h.queue.Queue(c.Request.Context(), entity.QueueDependencyCommand{NodeID: c.Param("node"), Action: body.Action, Actor: c.GetString(middleware.CtxUserIDKey)})
	if e != nil {
		c.JSON(422, gin.H{"error": e.Error()})
		return
	}
	c.JSON(202, out)
}
func (h *DependenciesHandler) Poll(c *gin.Context) {
	out, e := h.poll.Poll(c.Request.Context(), entity.PollDependencyQuery{NodeID: c.Param("node")})
	if e != nil {
		c.AbortWithStatus(500)
		return
	}
	c.JSON(200, out)
}
func (h *DependenciesHandler) Report(c *gin.Context) {
	var cmd entity.ReportDependencyCommand
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	if c.ShouldBindJSON(&cmd) != nil {
		c.AbortWithStatus(400)
		return
	}
	cmd.NodeID = c.Param("node")
	if e := h.report.Report(c.Request.Context(), cmd); e != nil {
		c.JSON(422, gin.H{"error": e.Error()})
		return
	}
	c.Status(204)
}
