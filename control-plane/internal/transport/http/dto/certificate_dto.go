package dto

import "aurora-waf.local/control-plane/internal/domain/entity"

type CreateCertificateRequest struct {
	Name        string   `json:"name" binding:"required"`
	SNIs        []string `json:"snis" binding:"required"`
	CertPEM     string   `json:"cert_pem" binding:"required"`
	KeyPEM      string   `json:"key_pem" binding:"required"`
	MTLSEnabled bool     `json:"mtls_enabled"`
	ClientCAPEM string   `json:"client_ca_pem"`
	VerifyDepth int      `json:"verify_depth"`
	Enabled     *bool    `json:"enabled"`
	Description string   `json:"description"`
}

type UpdateCertificateRequest struct {
	Name        string   `json:"name" binding:"required"`
	SNIs        []string `json:"snis" binding:"required"`
	CertPEM     string   `json:"cert_pem" binding:"required"`
	KeyPEM      string   `json:"key_pem" binding:"required"`
	MTLSEnabled bool     `json:"mtls_enabled"`
	ClientCAPEM string   `json:"client_ca_pem"`
	VerifyDepth int      `json:"verify_depth"`
	Enabled     *bool    `json:"enabled"`
	Description string   `json:"description"`
}

type CertificateResponse struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	SNIsJSON      string `json:"snis_json"`
	CertPEM       string `json:"cert_pem"`
	KeyConfigured bool   `json:"key_configured"`
	MTLSEnabled   bool   `json:"mtls_enabled"`
	ClientCAPEM   string `json:"client_ca_pem"`
	VerifyDepth   int    `json:"verify_depth"`
	Enabled       bool   `json:"enabled"`
	Description   string `json:"description"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
}

type ListCertificatesResponse struct {
	Items []CertificateResponse `json:"items"`
	Total int                   `json:"total"`
}

func ToCertificateResponse(item entity.CertificateItem) CertificateResponse {
	return CertificateResponse{
		ID:            item.ID,
		Name:          item.Name,
		SNIsJSON:      item.SNIsJSON,
		CertPEM:       item.CertPEM,
		KeyConfigured: item.KeyPEM != "",
		MTLSEnabled:   item.MTLSEnabled,
		ClientCAPEM:   item.ClientCAPEM,
		VerifyDepth:   item.VerifyDepth,
		Enabled:       item.Enabled,
		Description:   item.Description,
		CreatedAt:     item.CreatedAt,
		UpdatedAt:     item.UpdatedAt,
	}
}
