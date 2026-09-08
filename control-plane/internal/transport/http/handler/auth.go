package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const (
	authLoginTimeout = 5 * time.Second
)

type AuthHandler struct {
	service port.AuthService
}

func NewAuthHandler(service port.AuthService) *AuthHandler {
	return &AuthHandler{service: service}
}

// Login authenticates credentials and issues a JWT session cookie.
func (h *AuthHandler) Login(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.LoginRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": "request body exceeds 64KB limit"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body"})
		return
	}

	if err := decoder.Decode(new(any)); err != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trailing JSON in request body"})
		return
	}

	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), authLoginTimeout)
	defer cancel()

	result, err := h.service.Login(ctx, entity.LoginInput{
		Username: req.Username,
		Password: req.Password,
		Code:     req.Code,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "authentication timed out"})
			return
		}
		if errors.Is(err, taxonomy.ErrInvalidCredentials) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
			return
		}
		if errors.Is(err, taxonomy.ErrInvalid2FACode) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid two-factor authentication code"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Authentication failed"})
		return
	}

	// Nếu tài khoản yêu cầu xác thực 2FA bước 2
	if result.Requires2FA {
		c.JSON(http.StatusOK, gin.H{
			"requires_2fa":     true,
			"two_factor_token": result.TwoFactorToken,
		})
		return
	}

	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		"aurora_token",
		result.Token,
		int(result.ExpiresIn),
		"/",
		"",
		secure,
		true,
	)

	c.JSON(http.StatusOK, gin.H{
		"token":      result.Token,
		"token_type": result.TokenType,
		"expires_in": result.ExpiresIn,
		"user": gin.H{
			"id":       result.User.ID,
			"username": result.User.Username,
			"role":     result.User.Role,
		},
	})
}

// Verify2FALogin verifies the 2FA TOTP or backup recovery code and issues full session JWT.
func (h *AuthHandler) Verify2FALogin(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	contentType := c.GetHeader("Content-Type")
	if strings.Split(contentType, ";")[0] != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "application/json required"})
		return
	}

	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	var req dto.Verify2FALoginRequest
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON or unknown field in request body"})
		return
	}

	if strings.TrimSpace(req.TwoFactorToken) == "" || strings.TrimSpace(req.Code) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "two_factor_token and code are required"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), authLoginTimeout)
	defer cancel()

	result, err := h.service.Verify2FALogin(ctx, entity.Verify2FALoginInput{
		TwoFactorToken: req.TwoFactorToken,
		Code:           req.Code,
	})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "verification timed out"})
			return
		}
		if errors.Is(err, taxonomy.ErrInvalid2FACode) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid two-factor authentication code"})
			return
		}
		if errors.Is(err, taxonomy.ErrUnauthorized) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Two-factor verification session expired or invalid. Please sign in again."})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Verification failed"})
		return
	}

	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(
		"aurora_token",
		result.Token,
		int(result.ExpiresIn),
		"/",
		"",
		secure,
		true,
	)

	c.JSON(http.StatusOK, gin.H{
		"token":      result.Token,
		"token_type": result.TokenType,
		"expires_in": result.ExpiresIn,
		"user": gin.H{
			"id":       result.User.ID,
			"username": result.User.Username,
			"role":     result.User.Role,
		},
	})
}

// Me returns the current authenticated user identity.
func (h *AuthHandler) Me(c *gin.Context) {
	c.Header("Cache-Control", "no-store")

	if userID, exists := c.Get("user_id"); exists {
		username, _ := c.Get("username")
		role, _ := c.Get("role")
		c.JSON(http.StatusOK, gin.H{
			"user": gin.H{
				"id":       userID,
				"username": username,
				"role":     role,
			},
		})
		return
	}

	token := ""
	if authHeader := c.GetHeader("Authorization"); strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimPrefix(authHeader, "Bearer ")
	} else if cookie, err := c.Cookie("aurora_token"); err == nil {
		token = cookie
	}

	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Missing or invalid authorization"})
		return
	}

	claims, err := h.service.ValidateToken(token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":       claims.Subject,
			"username": claims.Username,
			"role":     claims.Role,
		},
	})
}

// Logout invalidates the session cookie.
func (h *AuthHandler) Logout(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("aurora_token", "", -1, "/", "", false, true)
	c.JSON(http.StatusOK, gin.H{"message": "Logged out successfully"})
}
