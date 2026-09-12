package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const (
	extensionQueryTimeout  = 5 * time.Second
	extensionActionTimeout = 10 * time.Second
)

// ExtensionHandler handles extension catalog and configuration HTTP requests.
type ExtensionHandler struct {
	service port.ExtensionService
}

// NewExtensionHandler creates a new ExtensionHandler instance.
func NewExtensionHandler(service port.ExtensionService) *ExtensionHandler {
	return &ExtensionHandler{service: service}
}

// List returns extensions filtered by category and status.
func (h *ExtensionHandler) List(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), extensionQueryTimeout)
	defer cancel()

	q := entity.ListExtensionsQuery{
		Category: c.Query("category"),
		Status:   c.Query("status"),
	}

	records, err := h.service.ListExtensions(ctx, q)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "list extensions timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	responses := make([]dto.ExtensionResponse, len(records))
	for i, r := range records {
		responses[i] = dto.ExtensionResponse{
			ID:               r.ID,
			ManifestKey:      r.ManifestKey,
			ManifestVersion:  r.ManifestVersion,
			ManifestDigest:   r.ManifestDigest,
			Name:             r.Name,
			Category:         r.Category,
			Description:      r.Description,
			Enabled:          r.Enabled,
			ConfigJSON:       r.ConfigJSON,
			ConfigSchemaJSON: r.ConfigSchemaJSON,
			UISchemaJSON:     r.UISchemaJSON,
			Supported:        r.Supported,
			IsBuiltin:        r.IsBuiltin,
			CreatedAt:        r.CreatedAt,
			UpdatedAt:        r.UpdatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"extensions": responses,
		"total":      len(responses),
	})
}

// GetByID returns a single extension by ID.
func (h *ExtensionHandler) GetByID(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.TrimSpace(c.Param("id"))

	ctx, cancel := context.WithTimeout(c.Request.Context(), extensionQueryTimeout)
	defer cancel()

	r, err := h.service.GetExtension(ctx, id)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get extension timed out"})
			return
		}
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp := dto.ExtensionResponse{
		ID:               r.ID,
		ManifestKey:      r.ManifestKey,
		ManifestVersion:  r.ManifestVersion,
		ManifestDigest:   r.ManifestDigest,
		Name:             r.Name,
		Category:         r.Category,
		Description:      r.Description,
		Enabled:          r.Enabled,
		ConfigJSON:       r.ConfigJSON,
		ConfigSchemaJSON: r.ConfigSchemaJSON,
		UISchemaJSON:     r.UISchemaJSON,
		Supported:        r.Supported,
		IsBuiltin:        r.IsBuiltin,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}

	c.JSON(http.StatusOK, resp)
}

// UpdateStatus toggles an extension enabled/disabled.
func (h *ExtensionHandler) UpdateStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.TrimSpace(c.Param("id"))

	var req dto.UpdateExtensionStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status payload: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), extensionActionTimeout)
	defer cancel()

	cmd := entity.UpdateExtensionStatusCommand{
		ID:      id,
		Enabled: req.Enabled,
	}

	if err := h.service.UpdateExtensionStatus(ctx, cmd); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "update extension status timed out"})
			return
		}
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "extension status updated successfully",
		"id":      id,
		"enabled": req.Enabled,
	})
}

// UpdateConfig updates the configuration of an extension.
func (h *ExtensionHandler) UpdateConfig(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.TrimSpace(c.Param("id"))

	var req dto.UpdateExtensionConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid config payload: " + err.Error()})
		return
	}

	configJSON := req.ConfigJSON
	if configJSON == "" && req.Config != nil {
		b, err := json.Marshal(req.Config)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "failed to serialize config object: " + err.Error()})
			return
		}
		configJSON = string(b)
	}

	if configJSON == "" {
		configJSON = "{}"
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), extensionActionTimeout)
	defer cancel()

	cmd := entity.UpdateExtensionConfigCommand{
		ID:         id,
		ConfigJSON: configJSON,
	}

	if err := h.service.UpdateExtensionConfig(ctx, cmd); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "update extension config timed out"})
			return
		}
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "extension config updated successfully",
		"id":      id,
	})
}
