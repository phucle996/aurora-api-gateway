package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
)

const (
	domainRoutingTimeout = 5 * time.Second // Dành cho Desired và Bundle snapshot
)

// DomainRoutingHandler provides routing synchronization endpoints for NGINX worker nodes.
type DomainRoutingHandler struct{ service port.DomainRoutingService }

// NewDomainRoutingHandler creates a new DomainRoutingHandler instance.
func NewDomainRoutingHandler(s port.DomainRoutingService) *DomainRoutingHandler {
	return &DomainRoutingHandler{service: s}
}

// Desired returns raw NGINX domain routing configuration with digest header.
func (h *DomainRoutingHandler) Desired(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), domainRoutingTimeout)
	defer cancel()

	r, e := h.service.DesiredRouting(ctx, entity.DomainRoutingQuery{NodeID: c.Param("node")})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.String(http.StatusGatewayTimeout, "routing snapshot timed out")
			return
		}
		c.String(http.StatusUnprocessableEntity, "routing snapshot unavailable: %s", e)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Aurora-Routing-Digest", r.Digest)
	c.Data(200, "text/plain; charset=utf-8", []byte(r.Config))
}

// Bundle returns the configuration bundle and certificates for a node.
func (h *DomainRoutingHandler) Bundle(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), domainRoutingTimeout)
	defer cancel()

	r, e := h.service.DesiredRouting(ctx, entity.DomainRoutingQuery{NodeID: c.Param("node")})
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			c.String(http.StatusGatewayTimeout, "routing snapshot timed out")
			return
		}
		c.String(http.StatusUnprocessableEntity, "routing snapshot unavailable")
		return
	}
	c.Header("Cache-Control", "no-store")

	files := make([]gin.H, len(r.Files))
	for i, f := range r.Files {
		files[i] = gin.H{
			"name":    f.Name,
			"content": f.Content,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"config": r.Config,
		"digest": r.Digest,
		"files":  files,
	})
}
