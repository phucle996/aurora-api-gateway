package handler

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
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
	certificateQueryTimeout  = 5 * time.Second
	certificateActionTimeout = 10 * time.Second
)

// CertificateHandler quản lý các HTTP endpoints của Certificate workflow.
type CertificateHandler struct {
	service port.CertificateService
}

func NewCertificateHandler(service port.CertificateService) *CertificateHandler {
	return &CertificateHandler{service: service}
}

// List trả về danh sách Certificate.
func (h *CertificateHandler) List(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), certificateQueryTimeout)
	defer cancel()

	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	q := entity.ListCertificatesQuery{
		Search: strings.TrimSpace(c.Query("search")),
		Limit:  limit,
		Offset: offset,
	}

	result, err := h.service.ListCertificates(ctx, q)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "list certificates timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	items := make([]dto.CertificateResponse, len(result.Items))
	for i, it := range result.Items {
		items[i] = dto.ToCertificateResponse(it)
	}

	c.JSON(http.StatusOK, dto.ListCertificatesResponse{
		Items: items,
		Total: result.Total,
	})
}

// GetByID trả về chi tiết một Certificate.
func (h *CertificateHandler) GetByID(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	ctx, cancel := context.WithTimeout(c.Request.Context(), certificateQueryTimeout)
	defer cancel()

	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id không được để trống"})
		return
	}

	item, err := h.service.GetCertificateByID(ctx, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if item == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "certificate not found"})
		return
	}

	c.JSON(http.StatusOK, dto.ToCertificateResponse(*item))
}

// Create tải lên một SSL Certificate mới.
func (h *CertificateHandler) Create(c *gin.Context) {
	var req dto.CreateCertificateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tên certificate không được để trống"})
		return
	}

	if len(req.SNIs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "danh sách SNIs phải chứa ít nhất 1 domain"})
		return
	}
	sanitizedSNIs := make([]string, 0, len(req.SNIs))
	for _, s := range req.SNIs {
		trimmed := strings.ToLower(strings.TrimSpace(s))
		if trimmed == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "SNI domain không được để trống"})
			return
		}
		sanitizedSNIs = append(sanitizedSNIs, trimmed)
	}

	certPEM := strings.TrimSpace(req.CertPEM)
	if certPEM == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "certificate PEM không được để trống"})
		return
	}
	keyPEM := strings.TrimSpace(req.KeyPEM)
	if keyPEM == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "private key PEM không được để trống"})
		return
	}

	if _, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cặp certificate và private key không hợp lệ: " + err.Error()})
		return
	}

	clientCAPEM := strings.TrimSpace(req.ClientCAPEM)
	if req.MTLSEnabled {
		if clientCAPEM == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "khi bật mTLS, client_ca_pem không được để trống"})
			return
		}
		block, _ := pem.Decode([]byte(clientCAPEM))
		if block == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "client_ca_pem không phải định dạng PEM hợp lệ"})
			return
		}
		if _, err := x509.ParseCertificate(block.Bytes); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "không thể parse client CA certificate: " + err.Error()})
			return
		}
	}

	verifyDepth := req.VerifyDepth
	if verifyDepth <= 0 {
		verifyDepth = 1
	}

	snisBytes, err := json.Marshal(sanitizedSNIs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid snis list"})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), certificateActionTimeout)
	defer cancel()

	cmd := entity.CreateCertificateCommand{
		Name:        name,
		SNIsJSON:    string(snisBytes),
		CertPEM:     certPEM,
		KeyPEM:      keyPEM,
		MTLSEnabled: req.MTLSEnabled,
		ClientCAPEM: clientCAPEM,
		VerifyDepth: verifyDepth,
		Enabled:     enabled,
		Description: strings.TrimSpace(req.Description),
	}

	created, err := h.service.CreateCertificate(ctx, cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, dto.ToCertificateResponse(*created))
}

// Update cập nhật một Certificate.
func (h *CertificateHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id không được để trống"})
		return
	}

	var req dto.UpdateCertificateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := strings.TrimSpace(req.Name)
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "tên certificate không được để trống"})
		return
	}

	if len(req.SNIs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "danh sách SNIs phải chứa ít nhất 1 domain"})
		return
	}
	sanitizedSNIs := make([]string, 0, len(req.SNIs))
	for _, s := range req.SNIs {
		trimmed := strings.ToLower(strings.TrimSpace(s))
		if trimmed == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "SNI domain không được để trống"})
			return
		}
		sanitizedSNIs = append(sanitizedSNIs, trimmed)
	}

	certPEM := strings.TrimSpace(req.CertPEM)
	if certPEM == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "certificate PEM không được để trống"})
		return
	}
	keyPEM := strings.TrimSpace(req.KeyPEM)
	if keyPEM == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "private key PEM không được để trống"})
		return
	}

	if _, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cặp certificate và private key không hợp lệ: " + err.Error()})
		return
	}

	clientCAPEM := strings.TrimSpace(req.ClientCAPEM)
	if req.MTLSEnabled {
		if clientCAPEM == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "khi bật mTLS, client_ca_pem không được để trống"})
			return
		}
		block, _ := pem.Decode([]byte(clientCAPEM))
		if block == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "client_ca_pem không phải định dạng PEM hợp lệ"})
			return
		}
		if _, err := x509.ParseCertificate(block.Bytes); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "không thể parse client CA certificate: " + err.Error()})
			return
		}
	}

	verifyDepth := req.VerifyDepth
	if verifyDepth <= 0 {
		verifyDepth = 1
	}

	snisBytes, err := json.Marshal(sanitizedSNIs)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid snis list"})
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), certificateActionTimeout)
	defer cancel()

	cmd := entity.UpdateCertificateCommand{
		ID:          id,
		Name:        name,
		SNIsJSON:    string(snisBytes),
		CertPEM:     certPEM,
		KeyPEM:      keyPEM,
		MTLSEnabled: req.MTLSEnabled,
		ClientCAPEM: clientCAPEM,
		VerifyDepth: verifyDepth,
		Enabled:     enabled,
		Description: strings.TrimSpace(req.Description),
	}

	updated, err := h.service.UpdateCertificate(ctx, cmd)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.ToCertificateResponse(*updated))
}

// Delete xóa Certificate.
func (h *CertificateHandler) Delete(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), certificateActionTimeout)
	defer cancel()

	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id không được để trống"})
		return
	}

	if err := h.service.DeleteCertificate(ctx, id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "certificate deleted successfully"})
}
