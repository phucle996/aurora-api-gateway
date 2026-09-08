package handler

import (
	"context"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
)

// HealthcheckHandler provides health and readiness endpoints for orchestrators and load balancers.
type HealthcheckHandler struct{ service service.HealthcheckService }

// NewHealthcheckHandler creates a new HealthcheckHandler instance.
func NewHealthcheckHandler(service service.HealthcheckService) *HealthcheckHandler {
	return &HealthcheckHandler{service: service}
}

// Health responds to liveness probes.
func (h *HealthcheckHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Status reports internal component stages and WAF enforcement readiness.
func (h *HealthcheckHandler) Status(c *gin.Context) {
	st := h.service.Status()
	c.JSON(http.StatusOK, gin.H{
		"component":         st.Component,
		"stage":             st.Stage,
		"enforcement_ready": st.EnforcementReady,
		"message":           st.Message,
	})
}

// Ready checks database connectivity with a 2-second timeout.
func (h *HealthcheckHandler) Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := h.service.Ready(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}
