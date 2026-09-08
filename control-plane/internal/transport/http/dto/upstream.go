package dto

import "aurora-waf.local/control-plane/internal/domain/entity"

// CreateUpstreamRequest là cấu trúc JSON đầu vào cho endpoint tạo mới Upstream Pool.
type CreateUpstreamRequest struct {
	Name             string                     `json:"name" binding:"required"`
	Description      string                     `json:"description"`
	ArchitectureType string                     `json:"architecture_type"`
	Algorithm        string                     `json:"algorithm"`
	Servers          []entity.UpstreamNode      `json:"servers"`
	ExternalFQDN     string                     `json:"external_fqdn"`
	SNIOverride      bool                       `json:"sni_override"`
	DynamicDNS       bool                       `json:"dynamic_dns"`
	InternalSSL      entity.UpstreamInternalSSL `json:"internal_ssl"`
	Probes           []entity.UpstreamProbe     `json:"probes"`
	Transport        entity.UpstreamTransport   `json:"transport"`
}

// UpdateUpstreamRequest là cấu trúc JSON đầu vào cho endpoint cập nhật Upstream Pool.
type UpdateUpstreamRequest struct {
	Name             string                     `json:"name" binding:"required"`
	Description      string                     `json:"description"`
	ArchitectureType string                     `json:"architecture_type"`
	Algorithm        string                     `json:"algorithm"`
	Servers          []entity.UpstreamNode      `json:"servers"`
	ExternalFQDN     string                     `json:"external_fqdn"`
	SNIOverride      bool                       `json:"sni_override"`
	DynamicDNS       bool                       `json:"dynamic_dns"`
	InternalSSL      entity.UpstreamInternalSSL `json:"internal_ssl"`
	Probes           []entity.UpstreamProbe     `json:"probes"`
	Transport        entity.UpstreamTransport   `json:"transport"`
}

// ListUpstreamsQueryRequest là query parameters khi truy vấn danh sách upstream.
type ListUpstreamsQueryRequest struct {
	Search           string `form:"search"`
	ArchitectureType string `form:"type"`
	Page             int    `form:"page,default=1"`
	Limit            int    `form:"limit,default=20"`
}

// UpstreamSyncReportRequest là payload báo cáo đồng bộ gửi từ NGINX Data Plane node.
type UpstreamSyncReportRequest struct {
	ReleaseID int64  `json:"release_id" binding:"required"`
	Phase     string `json:"phase" binding:"required"`
	Message   string `json:"message"`
}
