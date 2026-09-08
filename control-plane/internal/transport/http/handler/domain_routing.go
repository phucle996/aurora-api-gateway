package handler

import (
	"net/http"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
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
