package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const (
	l4QueryTimeout       = 5 * time.Second
	l4ActionTimeout      = 10 * time.Second
	maxL4ACLRules        = 256
	maxL4ACLRulePriority = 1_000_000
)

var nginxTimeoutLiteral = regexp.MustCompile(`^(?:0|(?:[1-9][0-9]*(?:ms|s|m|h|d|w|M|y))+)$`)

func isReservedL4TCPPort(protocol string, port int) bool {
	if protocol != "tcp" {
		return false
	}

	switch port {
	case 80, 443, 9081, 9082, 9443:
		return true
	default:
		return false
	}
}

// validateTimeout is shared by create and update because both mutations materialize its value
// directly into an NGINX directive.
func validateTimeout(value string) error {
	if !nginxTimeoutLiteral.MatchString(value) {
		return taxonomy.ErrL4InvalidTimeout
	}
	return nil
}

// L4Handler xử lý các yêu cầu HTTP liên quan tới L4 Gateway Services.
type L4Handler struct {
	service      port.L4Service
	upstreamRepo repo.UpstreamRepository
}

// NewL4Handler khởi tạo L4Handler.
func NewL4Handler(s port.L4Service, upstreamRepo repo.UpstreamRepository) *L4Handler {
	return &L4Handler{
		service:      s,
		upstreamRepo: upstreamRepo,
	}
}

// normalizeL4ACL is shared by the create and update workflows because the
// persisted order is the NGINX stream access evaluation order. A larger
// priority is evaluated first; ties are rejected rather than relying on an
// accidental JSON array order.
func normalizeL4ACL(aclJSON string) (string, error) {
	var rules []struct {
		CIDR        string `json:"cidr"`
		Action      string `json:"action"`
		Priority    *int   `json:"priority"`
		Description string `json:"description,omitempty"`
	}
	if err := json.Unmarshal([]byte(aclJSON), &rules); err != nil {
		return "", fmt.Errorf("invalid acl rules json: %w", err)
	}
	if len(rules) > maxL4ACLRules {
		return "", fmt.Errorf("too many acl rules: maximum is %d", maxL4ACLRules)
	}

	priorities := make(map[int]struct{}, len(rules))
	for i := range rules {
		rule := &rules[i]
		act := strings.ToLower(strings.TrimSpace(rule.Action))
		if act != "allow" && act != "deny" {
			return "", fmt.Errorf("invalid acl rule action %q, must be allow or deny", rule.Action)
		}
		if rule.Priority == nil || *rule.Priority < 1 || *rule.Priority > maxL4ACLRulePriority {
			return "", fmt.Errorf("acl rule priority must be between 1 and %d", maxL4ACLRulePriority)
		}
		if _, exists := priorities[*rule.Priority]; exists {
			return "", fmt.Errorf("acl rule priority %d is duplicated", *rule.Priority)
		}
		priorities[*rule.Priority] = struct{}{}

		cidr := strings.TrimSpace(rule.CIDR)
		if cidr == "" {
			return "", taxonomy.ErrL4InvalidCIDR
		}
		prefix, err := netip.ParsePrefix(cidr)
		if err != nil {
			addr, addrErr := netip.ParseAddr(cidr)
			if addrErr != nil {
				return "", taxonomy.ErrL4InvalidCIDR
			}
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}
		if prefix.Addr().Is4In6() {
			return "", taxonomy.ErrL4InvalidCIDR
		}

		rule.CIDR = prefix.Masked().String()
		rule.Action = act
		rule.Description = strings.TrimSpace(rule.Description)
	}

	sort.Slice(rules, func(i, j int) bool {
		return *rules[i].Priority > *rules[j].Priority
	})
	canonical, err := json.Marshal(rules)
	if err != nil {
		return "", fmt.Errorf("marshal acl rules: %w", err)
	}
	return string(canonical), nil
}

func (h *L4Handler) validateTarget(ctx context.Context, protocol, targetType, upstreamName, directEndpoint string) error {
	tt := strings.ToLower(strings.TrimSpace(targetType))
	if tt == "endpoint" {
		endpoint := strings.TrimSpace(directEndpoint)
		if endpoint == "" {
			return taxonomy.ErrL4InvalidEndpoint
		}
		host, portStr, err := net.SplitHostPort(endpoint)
		if err != nil || host == "" || portStr == "" {
			return taxonomy.ErrL4InvalidEndpoint
		}
		port, err := strconv.Atoi(portStr)
		if err != nil || port < 1 || port > 65535 {
			return taxonomy.ErrL4InvalidEndpoint
		}
		if protocol == "udp" && (endpoint == "127.0.0.1:80" || endpoint == "127.0.0.1:9443") {
			return taxonomy.ErrL4L7PipelineRequiresTCP
		}
		return nil
	}

	// Default: "upstream"
	name := strings.TrimSpace(upstreamName)
	if name == "" {
		return taxonomy.ErrL4TargetRequired
	}
	if h.upstreamRepo != nil {
		up, err := h.upstreamRepo.GetByName(ctx, name)
		if err != nil || up == nil {
			return taxonomy.ErrL4UpstreamNotFound
		}
	}
	return nil
}

// ─── L4 SERVICE HANDLERS ───────────────────────────────────────────────────────

// ListServices trả về danh sách L4 Services.
func (h *L4Handler) ListServices(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), l4QueryTimeout)
	defer cancel()

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	items, total, err := h.service.ListServices(ctx, entity.ListL4ServicesQuery{
		Search:   strings.TrimSpace(c.Query("search")),
		Protocol: strings.TrimSpace(c.Query("protocol")),
		Limit:    limit,
		Offset:   offset,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resItems := make([]gin.H, 0, len(items))
	for _, it := range items {
		resItems = append(resItems, gin.H{
			"id":                    it.ID,
			"name":                  it.Name,
			"protocol":              it.Protocol,
			"listen_port":           it.ListenPort,
			"forward_target_type":   it.ForwardTargetType,
			"upstream_name":         it.UpstreamName,
			"direct_endpoint":       it.DirectEndpoint,
			"acl_rules_json":        it.ACLRulesJSON,
			"proxy_timeout":         it.ProxyTimeout,
			"proxy_connect_timeout": it.ProxyConnectTimeout,
			"enabled":               it.Enabled,
			"description":           it.Description,
			"created_at":            it.CreatedAt,
			"updated_at":            it.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"items": resItems,
		"total": total,
	})
}

// GetService trả về chi tiết 1 L4 Service theo ID.
func (h *L4Handler) GetService(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service id is required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), l4QueryTimeout)
	defer cancel()

	item, err := h.service.GetServiceByID(ctx, id)
	if err != nil {
		if errors.Is(err, taxonomy.ErrL4ServiceNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                    item.ID,
		"name":                  item.Name,
		"protocol":              item.Protocol,
		"listen_port":           item.ListenPort,
		"forward_target_type":   item.ForwardTargetType,
		"upstream_name":         item.UpstreamName,
		"direct_endpoint":       item.DirectEndpoint,
		"acl_rules_json":        item.ACLRulesJSON,
		"proxy_timeout":         item.ProxyTimeout,
		"proxy_connect_timeout": item.ProxyConnectTimeout,
		"enabled":               item.Enabled,
		"description":           item.Description,
		"created_at":            item.CreatedAt,
		"updated_at":            item.UpdatedAt,
	})
}

// CreateService tạo mới một L4 Service.
func (h *L4Handler) CreateService(c *gin.Context) {
	var req dto.CreateL4ServiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service name cannot be empty"})
		return
	}

	proto := strings.ToLower(strings.TrimSpace(req.Protocol))
	if proto != "tcp" && proto != "udp" {
		proto = "tcp"
	}

	if req.ListenPort < 1 || req.ListenPort > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrL4InvalidPort.Error()})
		return
	}
	if isReservedL4TCPPort(proto, req.ListenPort) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrL4ReservedPort.Error()})
		return
	}

	targetType := strings.ToLower(strings.TrimSpace(req.ForwardTargetType))
	if targetType != "endpoint" {
		targetType = "upstream"
	}
	upstreamName := strings.TrimSpace(req.UpstreamName)
	directEndpoint := strings.TrimSpace(req.DirectEndpoint)

	ctx, cancel := context.WithTimeout(c.Request.Context(), l4ActionTimeout)
	defer cancel()

	if err := h.validateTarget(ctx, proto, targetType, upstreamName, directEndpoint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	aclJSON := strings.TrimSpace(req.ACLRulesJSON)
	if aclJSON == "" {
		aclJSON = "[]"
	}
	normalizedACL, err := normalizeL4ACL(aclJSON)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	aclJSON = normalizedACL

	// Kiểm tra port conflict
	existing, err := h.service.GetServiceByPortProto(ctx, proto, req.ListenPort)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing != nil {
		c.JSON(http.StatusConflict, gin.H{"error": taxonomy.ErrL4PortConflict.Error()})
		return
	}

	proxyTimeout := strings.TrimSpace(req.ProxyTimeout)
	if proxyTimeout == "" {
		proxyTimeout = "1h"
	}
	proxyConnectTimeout := strings.TrimSpace(req.ProxyConnectTimeout)
	if proxyConnectTimeout == "" {
		proxyConnectTimeout = "5s"
	}
	if err := validateTimeout(proxyTimeout); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateTimeout(proxyConnectTimeout); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	cmd := entity.CreateL4ServiceCommand{
		Name:                name,
		Protocol:            proto,
		ListenPort:          req.ListenPort,
		ForwardTargetType:   targetType,
		UpstreamName:        upstreamName,
		DirectEndpoint:      directEndpoint,
		ACLRulesJSON:        aclJSON,
		ProxyTimeout:        proxyTimeout,
		ProxyConnectTimeout: proxyConnectTimeout,
		Enabled:             enabled,
		Description:         strings.TrimSpace(req.Description),
	}

	item, err := h.service.CreateService(ctx, cmd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"id":                    item.ID,
		"name":                  item.Name,
		"protocol":              item.Protocol,
		"listen_port":           item.ListenPort,
		"forward_target_type":   item.ForwardTargetType,
		"upstream_name":         item.UpstreamName,
		"direct_endpoint":       item.DirectEndpoint,
		"acl_rules_json":        item.ACLRulesJSON,
		"proxy_timeout":         item.ProxyTimeout,
		"proxy_connect_timeout": item.ProxyConnectTimeout,
		"enabled":               item.Enabled,
		"description":           item.Description,
		"created_at":            item.CreatedAt,
		"updated_at":            item.UpdatedAt,
	})
}

// UpdateService cập nhật thông tin L4 Service.
func (h *L4Handler) UpdateService(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service id is required"})
		return
	}

	var req dto.UpdateL4ServiceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service name cannot be empty"})
		return
	}

	proto := strings.ToLower(strings.TrimSpace(req.Protocol))
	if proto != "tcp" && proto != "udp" {
		proto = "tcp"
	}

	if req.ListenPort < 1 || req.ListenPort > 65535 {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrL4InvalidPort.Error()})
		return
	}
	if isReservedL4TCPPort(proto, req.ListenPort) {
		c.JSON(http.StatusBadRequest, gin.H{"error": taxonomy.ErrL4ReservedPort.Error()})
		return
	}

	targetType := strings.ToLower(strings.TrimSpace(req.ForwardTargetType))
	if targetType != "endpoint" {
		targetType = "upstream"
	}
	upstreamName := strings.TrimSpace(req.UpstreamName)
	directEndpoint := strings.TrimSpace(req.DirectEndpoint)

	ctx, cancel := context.WithTimeout(c.Request.Context(), l4ActionTimeout)
	defer cancel()

	if err := h.validateTarget(ctx, proto, targetType, upstreamName, directEndpoint); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	aclJSON := strings.TrimSpace(req.ACLRulesJSON)
	if aclJSON == "" {
		aclJSON = "[]"
	}
	normalizedACL, err := normalizeL4ACL(aclJSON)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	aclJSON = normalizedACL

	// Kiểm tra port conflict
	existing, err := h.service.GetServiceByPortProto(ctx, proto, req.ListenPort)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if existing != nil && existing.ID != id {
		c.JSON(http.StatusConflict, gin.H{"error": taxonomy.ErrL4PortConflict.Error()})
		return
	}

	proxyTimeout := strings.TrimSpace(req.ProxyTimeout)
	if proxyTimeout == "" {
		proxyTimeout = "1h"
	}
	proxyConnectTimeout := strings.TrimSpace(req.ProxyConnectTimeout)
	if proxyConnectTimeout == "" {
		proxyConnectTimeout = "5s"
	}
	if err := validateTimeout(proxyTimeout); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateTimeout(proxyConnectTimeout); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	cmd := entity.UpdateL4ServiceCommand{
		ID:                  id,
		Name:                name,
		Protocol:            proto,
		ListenPort:          req.ListenPort,
		ForwardTargetType:   targetType,
		UpstreamName:        upstreamName,
		DirectEndpoint:      directEndpoint,
		ACLRulesJSON:        aclJSON,
		ProxyTimeout:        proxyTimeout,
		ProxyConnectTimeout: proxyConnectTimeout,
		Enabled:             enabled,
		Description:         strings.TrimSpace(req.Description),
	}

	item, err := h.service.UpdateService(ctx, cmd)
	if err != nil {
		if errors.Is(err, taxonomy.ErrL4ServiceNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                    item.ID,
		"name":                  item.Name,
		"protocol":              item.Protocol,
		"listen_port":           item.ListenPort,
		"forward_target_type":   item.ForwardTargetType,
		"upstream_name":         item.UpstreamName,
		"direct_endpoint":       item.DirectEndpoint,
		"acl_rules_json":        item.ACLRulesJSON,
		"proxy_timeout":         item.ProxyTimeout,
		"proxy_connect_timeout": item.ProxyConnectTimeout,
		"enabled":               item.Enabled,
		"description":           item.Description,
		"created_at":            item.CreatedAt,
		"updated_at":            item.UpdatedAt,
	})
}

// DeleteService xoá một L4 Service.
func (h *L4Handler) DeleteService(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service id is required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), l4ActionTimeout)
	defer cancel()

	if err := h.service.DeleteService(ctx, id); err != nil {
		if errors.Is(err, taxonomy.ErrL4ServiceNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "l4 service deleted successfully"})
}

// ToggleServiceStatus bật/tắt L4 Service nhanh.
func (h *L4Handler) ToggleServiceStatus(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "service id is required"})
		return
	}

	var req dto.ToggleL4ServiceStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), l4ActionTimeout)
	defer cancel()

	existing, err := h.service.GetServiceByID(ctx, id)
	if err != nil {
		if errors.Is(err, taxonomy.ErrL4ServiceNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	cmd := entity.UpdateL4ServiceCommand{
		ID:                  existing.ID,
		Name:                existing.Name,
		Protocol:            existing.Protocol,
		ListenPort:          existing.ListenPort,
		ForwardTargetType:   existing.ForwardTargetType,
		UpstreamName:        existing.UpstreamName,
		DirectEndpoint:      existing.DirectEndpoint,
		ACLRulesJSON:        existing.ACLRulesJSON,
		ProxyTimeout:        existing.ProxyTimeout,
		ProxyConnectTimeout: existing.ProxyConnectTimeout,
		Enabled:             req.Enabled,
		Description:         existing.Description,
	}

	updated, err := h.service.UpdateService(ctx, cmd)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                    updated.ID,
		"name":                  updated.Name,
		"protocol":              updated.Protocol,
		"listen_port":           updated.ListenPort,
		"forward_target_type":   updated.ForwardTargetType,
		"upstream_name":         updated.UpstreamName,
		"direct_endpoint":       updated.DirectEndpoint,
		"acl_rules_json":        updated.ACLRulesJSON,
		"proxy_timeout":         updated.ProxyTimeout,
		"proxy_connect_timeout": updated.ProxyConnectTimeout,
		"enabled":               updated.Enabled,
		"description":           updated.Description,
		"created_at":            updated.CreatedAt,
		"updated_at":            updated.UpdatedAt,
	})
}

// ToggleService is an alias for ToggleServiceStatus.
func (h *L4Handler) ToggleService(c *gin.Context) {
	h.ToggleServiceStatus(c)
}
