package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const (
	domainQueryTimeout  = 5 * time.Second  // Dành cho List, Catalog, GetByID truy vấn SQLite
	domainChangeTimeout = 10 * time.Second // Dành cho Create, Update, Delete domain (OCC & reload routing)
)

// DomainHandler manages virtual hosts, TLS/mTLS configurations, and upstream bindings.
type DomainHandler struct {
	service port.DomainService
}

// NewDomainHandler creates a new DomainHandler instance.
func NewDomainHandler(s port.DomainService) *DomainHandler {
	return &DomainHandler{service: s}
}

// List returns domains with search, filter, and pagination support.
func (h *DomainHandler) List(c *gin.Context) {
	search := c.Query("search")
	status := c.Query("status")
	tlsType := c.Query("tls_type")
	tag := c.Query("tag")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	query := entity.ListDomainsQuery{
		Search:  search,
		Status:  status,
		TLSType: tlsType,
		Tag:     tag,
		Limit:   limit,
		Offset:  offset,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), domainQueryTimeout)
	defer cancel()

	result, err := h.service.ListDomains(ctx, query)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "domain list query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query domains: " + err.Error()})
		return
	}

	items := make([]gin.H, 0, len(result.Items))
	for i := range result.Items {
		item := &result.Items[i]
		items = append(items, gin.H{
			"id":                 item.ID,
			"domain":             item.Domain,
			"root_domain":        item.RootDomain,
			"status":             item.Status,
			"tls_type":           item.TLSType,
			"tls_expiry":         item.TLSExpiry,
			"tls_auto_renew":     item.TLSAutoRenew,
			"min_tls_version":    item.MinTLSVersion,
			"hsts_enabled":       item.HSTSEnabled,
			"ocsp_stapling":      item.OCSPStapling,
			"client_ca_subject":  item.ClientCASubject,
			"upstream":           item.Upstream,
			"upstream_algorithm": item.UpstreamAlgorithm,
			"health_check_path":  item.HealthCheckPath,
			"tags":               item.Tags,
			"description":        item.Description,
			"rules_count":        item.RulesCount,
			"policies_count":     item.PoliciesCount,
			"ip_rules_count":     item.IPRulesCount,
			"rate_limits_count":  item.RateLimitsCount,
			"created_by":         item.CreatedBy,
			"created_at":         item.CreatedAt,
			"updated_at":         item.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"counts": gin.H{
			"total":        result.Counts.Total,
			"active":       result.Counts.Active,
			"inactive":     result.Counts.Inactive,
			"mtls_enabled": result.Counts.MTLSEnabled,
		},
		"total_filtered": result.TotalFiltered,
		"page":           page,
		"limit":          limit,
	})
}

// Catalog returns a lightweight list of domains for UI dropdowns.
func (h *DomainHandler) Catalog(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), domainQueryTimeout)
	defer cancel()

	result, err := h.service.DomainCatalog(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "domain catalog query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to query domain catalog: " + err.Error()})
		return
	}

	items := make([]gin.H, 0, len(result))
	for _, item := range result {
		items = append(items, gin.H{
			"id":          item.ID,
			"domain":      item.Domain,
			"root_domain": item.RootDomain,
			"status":      item.Status,
			"upstream":    item.Upstream,
		})
	}

	c.JSON(http.StatusOK, items)
}

// Create registers a new virtual host domain.
func (h *DomainHandler) Create(c *gin.Context) {
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.CreateDomainRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	req.Domain = strings.TrimSpace(req.Domain)
	if req.Domain == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domain is required"})
		return
	}
	if strings.TrimSpace(req.Upstream) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upstream is required"})
		return
	}

	cmd := entity.CreateDomainCommand{
		Domain:            req.Domain,
		RootDomain:        req.RootDomain,
		Status:            req.Status,
		TLSType:           req.TLSType,
		MinTLSVersion:     req.MinTLSVersion,
		HSTSEnabled:       req.HSTSEnabled,
		OCSPStapling:      req.OCSPStapling,
		ClientCASubject:   req.ClientCASubject,
		Upstream:          req.Upstream,
		UpstreamAlgorithm: req.UpstreamAlgorithm,
		HealthCheckPath:   req.HealthCheckPath,
		Tags:              req.Tags,
		Description:       req.Description,
		CreatedBy:         c.GetString("username"),
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), domainChangeTimeout)
	defer cancel()

	item, err := h.service.CreateDomain(ctx, cmd)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "create domain timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to create domain: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, domainItemToJSON(item))
}

// GetByID returns detailed information for a specific domain.
func (h *DomainHandler) GetByID(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid domain ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), domainQueryTimeout)
	defer cancel()

	item, err := h.service.GetDomain(ctx, id)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get domain timed out"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, domainItemToJSON(item))
}

// Update modifies an existing domain configuration.
func (h *DomainHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid domain ID"})
		return
	}

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.UpdateDomainRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	cmd := entity.UpdateDomainCommand{
		Status:            req.Status,
		TLSType:           req.TLSType,
		MinTLSVersion:     req.MinTLSVersion,
		HSTSEnabled:       req.HSTSEnabled,
		OCSPStapling:      req.OCSPStapling,
		ClientCASubject:   req.ClientCASubject,
		Upstream:          req.Upstream,
		UpstreamAlgorithm: req.UpstreamAlgorithm,
		HealthCheckPath:   req.HealthCheckPath,
		Tags:              req.Tags,
		Description:       req.Description,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), domainChangeTimeout)
	defer cancel()

	item, err := h.service.UpdateDomain(ctx, id, cmd)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "update domain timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to update domain: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, domainItemToJSON(item))
}

// Delete removes a domain by ID.
func (h *DomainHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid domain ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), domainChangeTimeout)
	defer cancel()

	if err := h.service.DeleteDomain(ctx, id); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "delete domain timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to delete domain: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": id})
}

func domainItemToJSON(item *entity.ListDomainsItem) gin.H {
	return gin.H{
		"id":                 item.ID,
		"domain":             item.Domain,
		"root_domain":        item.RootDomain,
		"status":             item.Status,
		"tls_type":           item.TLSType,
		"tls_expiry":         item.TLSExpiry,
		"tls_auto_renew":     item.TLSAutoRenew,
		"min_tls_version":    item.MinTLSVersion,
		"hsts_enabled":       item.HSTSEnabled,
		"ocsp_stapling":      item.OCSPStapling,
		"client_ca_subject":  item.ClientCASubject,
		"upstream":           item.Upstream,
		"upstream_algorithm": item.UpstreamAlgorithm,
		"health_check_path":  item.HealthCheckPath,
		"tags":               item.Tags,
		"description":        item.Description,
		"rules_count":        item.RulesCount,
		"policies_count":     item.PoliciesCount,
		"ip_rules_count":     item.IPRulesCount,
		"rate_limits_count":  item.RateLimitsCount,
		"created_by":         item.CreatedBy,
		"created_at":         item.CreatedAt,
		"updated_at":         item.UpdatedAt,
	}
}
