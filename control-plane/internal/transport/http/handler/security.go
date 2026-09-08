package handler

import (
	"context"
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
	securityQueryTimeout  = 5 * time.Second  // Dành cho GetOverview truy vấn cấu hình bảo mật
	securityActionTimeout = 10 * time.Second // Dành cho UpdateProvider, Init2FA, Verify2FA, Disable2FA, ChangePassword
)

// SecurityHandler handles system security settings, 2FA, and password management.
type SecurityHandler struct {
	service port.SecurityService
}

// NewSecurityHandler creates a new SecurityHandler instance.
func NewSecurityHandler(service port.SecurityService) *SecurityHandler {
	return &SecurityHandler{service: service}
}

func getUserIDAndName(c *gin.Context) (string, string) {
	userID := "usr_admin_01"
	username := "admin"
	if uid, exists := c.Get("user_id"); exists {
		if s, ok := uid.(string); ok && s != "" && s != "operator" {
			userID = s
		}
	}
	if uname, exists := c.Get("username"); exists {
		if s, ok := uname.(string); ok && s != "" && s != "operator" {
			username = s
		}
	}
	return userID, username
}

// GetOverview returns authentication providers, 2FA status, and admin account info.
func (h *SecurityHandler) GetOverview(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityQueryTimeout)
	defer cancel()

	overview, err := h.service.GetOverview(ctx, userID)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "security overview query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	providersList := make([]gin.H, len(overview.AuthProviders))
	for i, p := range overview.AuthProviders {
		providersList[i] = gin.H{
			"id":          p.ID,
			"name":        p.Name,
			"description": p.Description,
			"enabled":     p.Enabled,
			"config_json": p.ConfigJSON,
			"updated_at":  p.UpdatedAt,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"auth_providers": providersList,
		"two_factor": gin.H{
			"enabled":       overview.TwoFactor.Enabled,
			"configured":    overview.TwoFactor.Configured,
			"configured_at": overview.TwoFactor.ConfiguredAt,
		},
		"admin_username":        overview.AdminUsername,
		"password_last_updated": overview.PasswordLastUpdated,
	})
}

// UpdateProvider toggles or updates an authentication provider configuration.
func (h *SecurityHandler) UpdateProvider(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	id := strings.ToLower(c.Param("id"))

	var req dto.UpdateAuthProviderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid configuration data: " + err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	if err := h.service.UpdateProvider(ctx, id, req.Enabled, req.ConfigJSON); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "update auth provider timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "auth provider updated successfully",
		"id":      id,
		"enabled": req.Enabled,
	})
}

// Init2FA generates a 2FA secret and OTP auth URL.
func (h *SecurityHandler) Init2FA(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, username := getUserIDAndName(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	out, err := h.service.Init2FA(ctx, userID, username)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "init 2FA timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"secret":      out.Secret,
		"otpauth_url": out.OtpAuthURL,
		"qr_svg":      out.QrSVG,
	})
}

// Verify2FA validates a 6-digit code and enables 2FA.
func (h *SecurityHandler) Verify2FA(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	var req dto.Verify2FARequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "please provide secret and 6-digit verification code"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	out, err := h.service.Verify2FA(ctx, userID, entity.Verify2FACommand{
		Secret: req.Secret,
		Code:   req.Code,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "verify 2FA timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"enabled":        out.Enabled,
		"recovery_codes": out.RecoveryCodes,
	})
}

// Disable2FA disables two-factor authentication.
func (h *SecurityHandler) Disable2FA(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	if err := h.service.Disable2FA(ctx, userID); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "disable 2FA timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "two-factor authentication (2FA) disabled"})
}

// ChangePassword changes the authenticated user password.
func (h *SecurityHandler) ChangePassword(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	userID, _ := getUserIDAndName(c)

	var req dto.ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "new password must be at least 8 characters"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), securityActionTimeout)
	defer cancel()

	err := h.service.ChangePassword(ctx, userID, entity.ChangePasswordCommand{
		CurrentPassword: req.CurrentPassword,
		NewPassword:     req.NewPassword,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "change password timed out"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "password changed successfully"})
}
