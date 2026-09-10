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
	upstreamChangeTimeout = 10 * time.Second // Dành cho Create, Update, Delete upstream pool (OCC & reload)
	upstreamQueryTimeout  = 5 * time.Second  // Dành cho List, GetByID truy vấn SQLite
	upstreamSyncTimeout   = 5 * time.Second  // Dành cho node sync Desired snapshot và Report
)

// UpstreamHandler manages backend upstream pools, health probes, transport settings, and mTLS.
type UpstreamHandler struct {
	service port.UpstreamService
}

// NewUpstreamHandler creates a new UpstreamHandler instance.
func NewUpstreamHandler(s port.UpstreamService) *UpstreamHandler {
	return &UpstreamHandler{service: s}
}

// Create creates a new upstream pool.
func (h *UpstreamHandler) Create(c *gin.Context) {
	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 262144)
	var req dto.CreateUpstreamRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 256KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request data: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upstream pool name cannot be empty"})
		return
	}

	servers := make([]entity.UpstreamNode, len(req.Servers))
	for i, d := range req.Servers {
		servers[i] = entity.UpstreamNode{
			ID:          d.ID,
			Address:     d.Address,
			Weight:      d.Weight,
			MaxFails:    d.MaxFails,
			FailTimeout: d.FailTimeout,
			Backup:      d.Backup,
			Healthy:     d.Healthy,
		}
	}

	probes := make([]entity.UpstreamProbe, len(req.Probes))
	for i, d := range req.Probes {
		probes[i] = entity.UpstreamProbe{
			ID:             d.ID,
			Type:           d.Type,
			Path:           d.Path,
			ExpectedStatus: d.ExpectedStatus,
			IntervalSec:    d.IntervalSec,
			TimeoutSec:     d.TimeoutSec,
		}
	}

	cmd := entity.CreateUpstreamCommand{
		Name:             req.Name,
		Description:      req.Description,
		ArchitectureType: req.ArchitectureType,
		Algorithm:        req.Algorithm,
		Servers:          servers,
		ExternalFQDN:     req.ExternalFQDN,
		SNIOverride:      req.SNIOverride,
		DynamicDNS:       req.DynamicDNS,
		InternalSSL: entity.UpstreamInternalSSL{
			Enabled:             req.InternalSSL.Enabled,
			VerifyCert:          req.InternalSSL.VerifyCert,
			SNIHost:             req.InternalSSL.SNIHost,
			CACert:              req.InternalSSL.CACert,
			MTLS:                req.InternalSSL.MTLS,
			ClientCertName:      req.InternalSSL.ClientCertName,
			ClientCert:          req.InternalSSL.ClientCert,
			ClientKey:           req.InternalSSL.ClientKey,
			ClientKeyConfigured: req.InternalSSL.ClientKeyConfigured,
		},
		Probes: probes,
		Transport: entity.UpstreamTransport{
			RequestCompression:   req.Transport.RequestCompression,
			CompressionMinBytes:  req.Transport.CompressionMinBytes,
			CompressionLevel:     req.Transport.CompressionLevel,
			HTTPVersion:          req.Transport.HTTPVersion,
			EnableWebSocket:      req.Transport.EnableWebSocket,
			EnableSSE:            req.Transport.EnableSSE,
			EnableGRPC:           req.Transport.EnableGRPC,
			KeepAliveConnections: req.Transport.KeepAliveConnections,
			KeepAliveTimeout:     req.Transport.KeepAliveTimeout,
		},
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamChangeTimeout)
	defer cancel()

	item, err := h.service.CreateUpstream(ctx, cmd)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "create upstream pool timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	respServers := make([]gin.H, len(item.Servers))
	for i, s := range item.Servers {
		srv := gin.H{
			"id":      s.ID,
			"address": s.Address,
			"weight":  s.Weight,
			"healthy": s.Healthy,
		}
		if s.MaxFails > 0 {
			srv["maxFails"] = s.MaxFails
		}
		if s.FailTimeout != "" {
			srv["failTimeout"] = s.FailTimeout
		}
		if s.Backup {
			srv["backup"] = s.Backup
		}
		respServers[i] = srv
	}

	respProbes := make([]gin.H, len(item.Probes))
	for i, p := range item.Probes {
		pr := gin.H{
			"id":             p.ID,
			"type":           p.Type,
			"path":           p.Path,
			"expectedStatus": p.ExpectedStatus,
		}
		if p.IntervalSec > 0 {
			pr["intervalSec"] = p.IntervalSec
		}
		if p.TimeoutSec > 0 {
			pr["timeoutSec"] = p.TimeoutSec
		}
		respProbes[i] = pr
	}

	respSSL := gin.H{
		"enabled":             item.InternalSSL.Enabled,
		"verifyCert":          item.InternalSSL.VerifyCert,
		"mTLS":                item.InternalSSL.MTLS,
		"clientKeyConfigured": item.InternalSSL.ClientKey != "" || item.InternalSSL.ClientKeyConfigured,
	}
	if item.InternalSSL.SNIHost != "" {
		respSSL["sniHost"] = item.InternalSSL.SNIHost
	}
	if item.InternalSSL.CACert != "" {
		respSSL["caCert"] = item.InternalSSL.CACert
	}
	if item.InternalSSL.ClientCertName != "" {
		respSSL["clientCertName"] = item.InternalSSL.ClientCertName
	}
	if item.InternalSSL.ClientCert != "" {
		respSSL["clientCert"] = item.InternalSSL.ClientCert
	}

	respTransport := gin.H{
		"requestCompression":  item.Transport.RequestCompression,
		"compressionMinBytes": item.Transport.CompressionMinBytes,
		"compressionLevel":    item.Transport.CompressionLevel,
		"httpVersion":         item.Transport.HTTPVersion,
		"enableWebSocket":     item.Transport.EnableWebSocket,
		"enableSse":           item.Transport.EnableSSE,
		"enableGrpc":          item.Transport.EnableGRPC,
	}
	if item.Transport.KeepAliveConnections > 0 {
		respTransport["keepAliveConnections"] = item.Transport.KeepAliveConnections
	}
	if item.Transport.KeepAliveTimeout > 0 {
		respTransport["keepAliveTimeout"] = item.Transport.KeepAliveTimeout
	}

	resp := gin.H{
		"id":                  item.ID,
		"name":                item.Name,
		"description":         item.Description,
		"architecture_type":   item.ArchitectureType,
		"algorithm":           item.Algorithm,
		"servers":             respServers,
		"sni_override":        item.SNIOverride,
		"dynamic_dns":         item.DynamicDNS,
		"internal_ssl":        respSSL,
		"probes":              respProbes,
		"transport":           respTransport,
		"version":             item.Version,
		"bound_domains_count": item.BoundDomainsCount,
		"created_at":          item.CreatedAt,
		"updated_at":          item.UpdatedAt,
	}
	if item.ExternalFQDN != "" {
		resp["external_fqdn"] = item.ExternalFQDN
	}

	c.JSON(http.StatusCreated, resp)
}

// Update modifies an existing upstream pool.
func (h *UpstreamHandler) Update(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upstream ID"})
		return
	}

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 262144)
	var req dto.UpdateUpstreamRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 256KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upstream update data: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	servers := make([]entity.UpstreamNode, len(req.Servers))
	for i, d := range req.Servers {
		servers[i] = entity.UpstreamNode{
			ID:          d.ID,
			Address:     d.Address,
			Weight:      d.Weight,
			MaxFails:    d.MaxFails,
			FailTimeout: d.FailTimeout,
			Backup:      d.Backup,
			Healthy:     d.Healthy,
		}
	}

	probes := make([]entity.UpstreamProbe, len(req.Probes))
	for i, d := range req.Probes {
		probes[i] = entity.UpstreamProbe{
			ID:             d.ID,
			Type:           d.Type,
			Path:           d.Path,
			ExpectedStatus: d.ExpectedStatus,
			IntervalSec:    d.IntervalSec,
			TimeoutSec:     d.TimeoutSec,
		}
	}

	cmd := entity.UpdateUpstreamCommand{
		ID:               id,
		Name:             req.Name,
		Description:      req.Description,
		ArchitectureType: req.ArchitectureType,
		Algorithm:        req.Algorithm,
		Servers:          servers,
		ExternalFQDN:     req.ExternalFQDN,
		SNIOverride:      req.SNIOverride,
		DynamicDNS:       req.DynamicDNS,
		InternalSSL: entity.UpstreamInternalSSL{
			Enabled:             req.InternalSSL.Enabled,
			VerifyCert:          req.InternalSSL.VerifyCert,
			SNIHost:             req.InternalSSL.SNIHost,
			CACert:              req.InternalSSL.CACert,
			MTLS:                req.InternalSSL.MTLS,
			ClientCertName:      req.InternalSSL.ClientCertName,
			ClientCert:          req.InternalSSL.ClientCert,
			ClientKey:           req.InternalSSL.ClientKey,
			ClientKeyConfigured: req.InternalSSL.ClientKeyConfigured,
		},
		Probes: probes,
		Transport: entity.UpstreamTransport{
			RequestCompression:   req.Transport.RequestCompression,
			CompressionMinBytes:  req.Transport.CompressionMinBytes,
			CompressionLevel:     req.Transport.CompressionLevel,
			HTTPVersion:          req.Transport.HTTPVersion,
			EnableWebSocket:      req.Transport.EnableWebSocket,
			EnableSSE:            req.Transport.EnableSSE,
			EnableGRPC:           req.Transport.EnableGRPC,
			KeepAliveConnections: req.Transport.KeepAliveConnections,
			KeepAliveTimeout:     req.Transport.KeepAliveTimeout,
		},
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamChangeTimeout)
	defer cancel()

	item, err := h.service.UpdateUpstream(ctx, cmd)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "update upstream pool timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	respServers := make([]gin.H, len(item.Servers))
	for i, s := range item.Servers {
		srv := gin.H{
			"id":      s.ID,
			"address": s.Address,
			"weight":  s.Weight,
			"healthy": s.Healthy,
		}
		if s.MaxFails > 0 {
			srv["maxFails"] = s.MaxFails
		}
		if s.FailTimeout != "" {
			srv["failTimeout"] = s.FailTimeout
		}
		if s.Backup {
			srv["backup"] = s.Backup
		}
		respServers[i] = srv
	}

	respProbes := make([]gin.H, len(item.Probes))
	for i, p := range item.Probes {
		pr := gin.H{
			"id":             p.ID,
			"type":           p.Type,
			"path":           p.Path,
			"expectedStatus": p.ExpectedStatus,
		}
		if p.IntervalSec > 0 {
			pr["intervalSec"] = p.IntervalSec
		}
		if p.TimeoutSec > 0 {
			pr["timeoutSec"] = p.TimeoutSec
		}
		respProbes[i] = pr
	}

	respSSL := gin.H{
		"enabled":             item.InternalSSL.Enabled,
		"verifyCert":          item.InternalSSL.VerifyCert,
		"mTLS":                item.InternalSSL.MTLS,
		"clientKeyConfigured": item.InternalSSL.ClientKey != "" || item.InternalSSL.ClientKeyConfigured,
	}
	if item.InternalSSL.SNIHost != "" {
		respSSL["sniHost"] = item.InternalSSL.SNIHost
	}
	if item.InternalSSL.CACert != "" {
		respSSL["caCert"] = item.InternalSSL.CACert
	}
	if item.InternalSSL.ClientCertName != "" {
		respSSL["clientCertName"] = item.InternalSSL.ClientCertName
	}
	if item.InternalSSL.ClientCert != "" {
		respSSL["clientCert"] = item.InternalSSL.ClientCert
	}

	respTransport := gin.H{
		"requestCompression":  item.Transport.RequestCompression,
		"compressionMinBytes": item.Transport.CompressionMinBytes,
		"compressionLevel":    item.Transport.CompressionLevel,
		"httpVersion":         item.Transport.HTTPVersion,
		"enableWebSocket":     item.Transport.EnableWebSocket,
		"enableSse":           item.Transport.EnableSSE,
		"enableGrpc":          item.Transport.EnableGRPC,
	}
	if item.Transport.KeepAliveConnections > 0 {
		respTransport["keepAliveConnections"] = item.Transport.KeepAliveConnections
	}
	if item.Transport.KeepAliveTimeout > 0 {
		respTransport["keepAliveTimeout"] = item.Transport.KeepAliveTimeout
	}

	resp := gin.H{
		"id":                  item.ID,
		"name":                item.Name,
		"description":         item.Description,
		"architecture_type":   item.ArchitectureType,
		"algorithm":           item.Algorithm,
		"servers":             respServers,
		"sni_override":        item.SNIOverride,
		"dynamic_dns":         item.DynamicDNS,
		"internal_ssl":        respSSL,
		"probes":              respProbes,
		"transport":           respTransport,
		"version":             item.Version,
		"bound_domains_count": item.BoundDomainsCount,
		"created_at":          item.CreatedAt,
		"updated_at":          item.UpdatedAt,
	}
	if item.ExternalFQDN != "" {
		resp["external_fqdn"] = item.ExternalFQDN
	}

	c.JSON(http.StatusOK, resp)
}

// List returns all upstream pools.
func (h *UpstreamHandler) List(c *gin.Context) {
	search := c.Query("search")
	archType := c.Query("type")

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	offset := (page - 1) * limit

	query := entity.ListUpstreamsQuery{
		Search:           search,
		ArchitectureType: archType,
		Limit:            limit,
		Offset:           offset,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamQueryTimeout)
	defer cancel()

	items, total, err := h.service.ListUpstreams(ctx, query)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "upstream list query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query upstreams: " + err.Error()})
		return
	}

	listItems := make([]gin.H, len(items))
	for i := range items {
		item := &items[i]
		respServers := make([]gin.H, len(item.Servers))
		for j, s := range item.Servers {
			srv := gin.H{
				"id":      s.ID,
				"address": s.Address,
				"weight":  s.Weight,
				"healthy": s.Healthy,
			}
			if s.MaxFails > 0 {
				srv["maxFails"] = s.MaxFails
			}
			if s.FailTimeout != "" {
				srv["failTimeout"] = s.FailTimeout
			}
			if s.Backup {
				srv["backup"] = s.Backup
			}
			respServers[j] = srv
		}

		respProbes := make([]gin.H, len(item.Probes))
		for j, p := range item.Probes {
			pr := gin.H{
				"id":             p.ID,
				"type":           p.Type,
				"path":           p.Path,
				"expectedStatus": p.ExpectedStatus,
			}
			if p.IntervalSec > 0 {
				pr["intervalSec"] = p.IntervalSec
			}
			if p.TimeoutSec > 0 {
				pr["timeoutSec"] = p.TimeoutSec
			}
			respProbes[j] = pr
		}

		ssl := gin.H{
			"enabled":             item.InternalSSL.Enabled,
			"verifyCert":          item.InternalSSL.VerifyCert,
			"mTLS":                item.InternalSSL.MTLS,
			"clientKeyConfigured": item.InternalSSL.ClientKey != "" || item.InternalSSL.ClientKeyConfigured,
		}
		if item.InternalSSL.SNIHost != "" {
			ssl["sniHost"] = item.InternalSSL.SNIHost
		}
		if item.InternalSSL.CACert != "" {
			ssl["caCert"] = item.InternalSSL.CACert
		}
		if item.InternalSSL.ClientCertName != "" {
			ssl["clientCertName"] = item.InternalSSL.ClientCertName
		}
		if item.InternalSSL.ClientCert != "" {
			ssl["clientCert"] = item.InternalSSL.ClientCert
		}

		transport := gin.H{
			"requestCompression":  item.Transport.RequestCompression,
			"compressionMinBytes": item.Transport.CompressionMinBytes,
			"compressionLevel":    item.Transport.CompressionLevel,
			"httpVersion":         item.Transport.HTTPVersion,
			"enableWebSocket":     item.Transport.EnableWebSocket,
			"enableSse":           item.Transport.EnableSSE,
			"enableGrpc":          item.Transport.EnableGRPC,
		}
		if item.Transport.KeepAliveConnections > 0 {
			transport["keepAliveConnections"] = item.Transport.KeepAliveConnections
		}
		if item.Transport.KeepAliveTimeout > 0 {
			transport["keepAliveTimeout"] = item.Transport.KeepAliveTimeout
		}

		row := gin.H{
			"id":                  item.ID,
			"name":                item.Name,
			"description":         item.Description,
			"architecture_type":   item.ArchitectureType,
			"algorithm":           item.Algorithm,
			"servers":             respServers,
			"sni_override":        item.SNIOverride,
			"dynamic_dns":         item.DynamicDNS,
			"internal_ssl":        ssl,
			"probes":              respProbes,
			"transport":           transport,
			"version":             item.Version,
			"bound_domains_count": item.BoundDomainsCount,
			"created_at":          item.CreatedAt,
			"updated_at":          item.UpdatedAt,
		}
		if item.ExternalFQDN != "" {
			row["external_fqdn"] = item.ExternalFQDN
		}
		listItems[i] = row
	}

	c.JSON(http.StatusOK, gin.H{
		"items": listItems,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}

// GetByID returns an upstream pool by ID.
func (h *UpstreamHandler) GetByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upstream ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamQueryTimeout)
	defer cancel()

	item, err := h.service.GetUpstream(ctx, id)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get upstream timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get upstream: " + err.Error()})
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "upstream not found"})
		return
	}

	respServers := make([]gin.H, len(item.Servers))
	for i, s := range item.Servers {
		srv := gin.H{
			"id":      s.ID,
			"address": s.Address,
			"weight":  s.Weight,
			"healthy": s.Healthy,
		}
		if s.MaxFails > 0 {
			srv["maxFails"] = s.MaxFails
		}
		if s.FailTimeout != "" {
			srv["failTimeout"] = s.FailTimeout
		}
		if s.Backup {
			srv["backup"] = s.Backup
		}
		respServers[i] = srv
	}

	respProbes := make([]gin.H, len(item.Probes))
	for i, p := range item.Probes {
		pr := gin.H{
			"id":             p.ID,
			"type":           p.Type,
			"path":           p.Path,
			"expectedStatus": p.ExpectedStatus,
		}
		if p.IntervalSec > 0 {
			pr["intervalSec"] = p.IntervalSec
		}
		if p.TimeoutSec > 0 {
			pr["timeoutSec"] = p.TimeoutSec
		}
		respProbes[i] = pr
	}

	ssl := gin.H{
		"enabled":             item.InternalSSL.Enabled,
		"verifyCert":          item.InternalSSL.VerifyCert,
		"mTLS":                item.InternalSSL.MTLS,
		"clientKeyConfigured": item.InternalSSL.ClientKey != "" || item.InternalSSL.ClientKeyConfigured,
	}
	if item.InternalSSL.SNIHost != "" {
		ssl["sniHost"] = item.InternalSSL.SNIHost
	}
	if item.InternalSSL.CACert != "" {
		ssl["caCert"] = item.InternalSSL.CACert
	}
	if item.InternalSSL.ClientCertName != "" {
		ssl["clientCertName"] = item.InternalSSL.ClientCertName
	}
	if item.InternalSSL.ClientCert != "" {
		ssl["clientCert"] = item.InternalSSL.ClientCert
	}

	transport := gin.H{
		"requestCompression":  item.Transport.RequestCompression,
		"compressionMinBytes": item.Transport.CompressionMinBytes,
		"compressionLevel":    item.Transport.CompressionLevel,
		"httpVersion":         item.Transport.HTTPVersion,
		"enableWebSocket":     item.Transport.EnableWebSocket,
		"enableSse":           item.Transport.EnableSSE,
		"enableGrpc":          item.Transport.EnableGRPC,
	}
	if item.Transport.KeepAliveConnections > 0 {
		transport["keepAliveConnections"] = item.Transport.KeepAliveConnections
	}
	if item.Transport.KeepAliveTimeout > 0 {
		transport["keepAliveTimeout"] = item.Transport.KeepAliveTimeout
	}

	resp := gin.H{
		"id":                  item.ID,
		"name":                item.Name,
		"description":         item.Description,
		"architecture_type":   item.ArchitectureType,
		"algorithm":           item.Algorithm,
		"servers":             respServers,
		"sni_override":        item.SNIOverride,
		"dynamic_dns":         item.DynamicDNS,
		"internal_ssl":        ssl,
		"probes":              respProbes,
		"transport":           transport,
		"version":             item.Version,
		"bound_domains_count": item.BoundDomainsCount,
		"created_at":          item.CreatedAt,
		"updated_at":          item.UpdatedAt,
	}
	if item.ExternalFQDN != "" {
		resp["external_fqdn"] = item.ExternalFQDN
	}

	c.JSON(http.StatusOK, resp)
}

// Delete removes an upstream pool by ID.
func (h *UpstreamHandler) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid upstream ID"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamChangeTimeout)
	defer cancel()

	if err := h.service.DeleteUpstream(ctx, id); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "delete upstream timed out"})
			return
		}
		if strings.Contains(err.Error(), "still referenced by routes") || strings.Contains(err.Error(), "still referenced by domains") {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if strings.Contains(err.Error(), "not found") {
			c.JSON(http.StatusNotFound, gin.H{"error": "upstream not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete upstream: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": id})
}

// Desired returns the active compiled upstream snapshot configuration for worker nodes.
func (h *UpstreamHandler) Desired(c *gin.Context) {
	nodeID := c.Param("node")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamSyncTimeout)
	defer cancel()

	snapshot, err := h.service.GetDesiredSnapshot(ctx, nodeID)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get desired upstream snapshot timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get desired upstream snapshot: " + err.Error()})
		return
	}

	upstreams := make([]gin.H, len(snapshot.Upstreams))
	for i := range snapshot.Upstreams {
		item := &snapshot.Upstreams[i]
		respServers := make([]gin.H, len(item.Servers))
		for j, s := range item.Servers {
			srv := gin.H{
				"id":      s.ID,
				"address": s.Address,
				"weight":  s.Weight,
				"healthy": s.Healthy,
			}
			if s.MaxFails > 0 {
				srv["maxFails"] = s.MaxFails
			}
			if s.FailTimeout != "" {
				srv["failTimeout"] = s.FailTimeout
			}
			if s.Backup {
				srv["backup"] = s.Backup
			}
			respServers[j] = srv
		}

		respProbes := make([]gin.H, len(item.Probes))
		for j, p := range item.Probes {
			pr := gin.H{
				"id":             p.ID,
				"type":           p.Type,
				"path":           p.Path,
				"expectedStatus": p.ExpectedStatus,
			}
			if p.IntervalSec > 0 {
				pr["intervalSec"] = p.IntervalSec
			}
			if p.TimeoutSec > 0 {
				pr["timeoutSec"] = p.TimeoutSec
			}
			respProbes[j] = pr
		}

		ssl := gin.H{
			"enabled":             item.InternalSSL.Enabled,
			"verifyCert":          item.InternalSSL.VerifyCert,
			"mTLS":                item.InternalSSL.MTLS,
			"clientKeyConfigured": item.InternalSSL.ClientKey != "" || item.InternalSSL.ClientKeyConfigured,
		}
		if item.InternalSSL.SNIHost != "" {
			ssl["sniHost"] = item.InternalSSL.SNIHost
		}
		if item.InternalSSL.CACert != "" {
			ssl["caCert"] = item.InternalSSL.CACert
		}
		if item.InternalSSL.ClientCertName != "" {
			ssl["clientCertName"] = item.InternalSSL.ClientCertName
		}
		if item.InternalSSL.ClientCert != "" {
			ssl["clientCert"] = item.InternalSSL.ClientCert
		}

		transport := gin.H{
			"requestCompression":  item.Transport.RequestCompression,
			"compressionMinBytes": item.Transport.CompressionMinBytes,
			"compressionLevel":    item.Transport.CompressionLevel,
			"httpVersion":         item.Transport.HTTPVersion,
			"enableWebSocket":     item.Transport.EnableWebSocket,
			"enableSse":           item.Transport.EnableSSE,
			"enableGrpc":          item.Transport.EnableGRPC,
		}
		if item.Transport.KeepAliveConnections > 0 {
			transport["keepAliveConnections"] = item.Transport.KeepAliveConnections
		}
		if item.Transport.KeepAliveTimeout > 0 {
			transport["keepAliveTimeout"] = item.Transport.KeepAliveTimeout
		}

		row := gin.H{
			"id":                  item.ID,
			"name":                item.Name,
			"description":         item.Description,
			"architecture_type":   item.ArchitectureType,
			"algorithm":           item.Algorithm,
			"servers":             respServers,
			"sni_override":        item.SNIOverride,
			"dynamic_dns":         item.DynamicDNS,
			"internal_ssl":        ssl,
			"probes":              respProbes,
			"transport":           transport,
			"version":             item.Version,
			"bound_domains_count": item.BoundDomainsCount,
			"created_at":          item.CreatedAt,
			"updated_at":          item.UpdatedAt,
		}
		if item.ExternalFQDN != "" {
			row["external_fqdn"] = item.ExternalFQDN
		}
		upstreams[i] = row
	}

	c.JSON(http.StatusOK, gin.H{
		"release_id":     snapshot.ReleaseID,
		"digest":         snapshot.Digest,
		"upstreams":      upstreams,
		"config_content": snapshot.ConfigContent,
	})
}

// Report receives upstream reload results from worker nodes.
func (h *UpstreamHandler) Report(c *gin.Context) {
	nodeID := c.Param("node")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.UpstreamSyncReportRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid report data: " + err.Error()})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), upstreamSyncTimeout)
	defer cancel()

	err := h.service.ReportSyncStatus(ctx, nodeID, req.ReleaseID, req.Phase, req.Message)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "record sync report timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record sync report: " + err.Error()})
		return
	}

	c.Status(http.StatusNoContent)
}
