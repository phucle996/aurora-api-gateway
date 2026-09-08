package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
	"net/http"
)

type DomainRoutingHandler struct{ service port.DomainRoutingService }

func NewDomainRoutingHandler(s port.DomainRoutingService) *DomainRoutingHandler {
	return &DomainRoutingHandler{service: s}
}
func (h *DomainRoutingHandler) Desired(c *gin.Context) {
	r, e := h.service.DesiredRouting(c.Request.Context(), entity.DomainRoutingQuery{NodeID: c.Param("node")})
	if e != nil {
		c.String(http.StatusUnprocessableEntity, "routing snapshot unavailable: %s", e)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("X-Aurora-Routing-Digest", r.Digest)
	c.Data(200, "text/plain; charset=utf-8", []byte(r.Config))
}

// Bundle is registered behind the operator header-token gate, never cookie/query authentication.
func (h *DomainRoutingHandler) Bundle(c *gin.Context) {
	r, e := h.service.DesiredRouting(c.Request.Context(), entity.DomainRoutingQuery{NodeID: c.Param("node")})
	if e != nil {
		c.String(http.StatusUnprocessableEntity, "routing snapshot unavailable")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, r)
}
