package handler

import (
	"net/http"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

// DomainHandler bao đóng các HTTP endpoint cho Domain management workflow.
type DomainHandler struct {
	service port.DomainService
}

// NewDomainHandler khởi tạo handler với DomainService.
func NewDomainHandler(s port.DomainService) *DomainHandler {
	return &DomainHandler{service: s}
}

// List xử lý HTTP GET /api/v1/domains:
// Nhận các tiêu chí tìm kiếm, lọc theo status, tls_type, tag, và phân trang.
func (h *DomainHandler) List(c *gin.Context) {
	var req dto.ListDomainsQueryRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid query parameters: " + err.Error()})
		return
	}

	page := req.Page
	if page < 1 {
		page = 1
	}
	limit := req.Limit
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	query := entity.ListDomainsQuery{
		Search:  req.Search,
		Status:  req.Status,
		TLSType: req.TLSType,
		Tag:     req.Tag,
		Limit:   limit,
		Offset:  offset,
	}

	result, err := h.service.ListDomains(c.Request.Context(), query)
	if err != nil {
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
