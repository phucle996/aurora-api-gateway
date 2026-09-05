package handler

import (
	"aurora-waf.local/control-plane/internal/domain/service"
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

type StatusHandler struct{ service service.StatusService }

func NewStatusHandler(service service.StatusService) *StatusHandler {
	return &StatusHandler{service: service}
}

func (h *StatusHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (h *StatusHandler) Status(c *gin.Context) {
	st := h.service.Status()
	c.JSON(http.StatusOK, gin.H{
		"component":         st.Component,
		"stage":             st.Stage,
		"enforcement_ready": st.EnforcementReady,
		"message":           st.Message,
	})
}

// Ready checks controller storage, not WAF enforcement or database write capacity.
func (h *StatusHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := h.service.Ready(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
