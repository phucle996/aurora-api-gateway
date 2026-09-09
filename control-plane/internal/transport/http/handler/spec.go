package handler

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"github.com/gin-gonic/gin"
)

type SpecHandler struct {
	specService port.SpecSyncService
}

func NewSpecHandler(specService port.SpecSyncService) *SpecHandler {
	return &SpecHandler{
		specService: specService,
	}
}

func (h *SpecHandler) GetSpec(c *gin.Context) {
	nodeID := c.Query("node_id")
	if nodeID == "" {
		nodeID = c.Param("node")
	}
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "node_id is required"})
		return
	}

	currentHash := c.Query("current_hash")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	res, err := h.specService.SyncSpec(ctx, entity.SpecSyncQuery{
		NodeID:      nodeID,
		CurrentHash: currentHash,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"message": fmt.Sprintf("failed to sync spec: %v", err)})
		return
	}

	if res.InSync {
		c.Status(http.StatusNotModified)
		return
	}

	c.Header("Content-Type", "application/yaml")
	c.Header("X-Aurora-Spec-Hash", res.Hash)
	c.Header("X-Aurora-Release-ID", fmt.Sprintf("%d", res.ReleaseID))
	c.String(http.StatusOK, res.SpecYAML)
}
