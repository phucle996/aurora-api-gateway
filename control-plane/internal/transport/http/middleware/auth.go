package middleware

import (
	port "aurora-waf.local/control-plane/internal/domain/service"
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	CtxUserIDKey   = "user_id"
	CtxUsernameKey = "username"
	CtxUserRoleKey = "role"
)

// Auth is the application-wide authentication and security middleware.
// It authenticates via JWT (Bearer header or aurora_token cookie) or static operator token (if configured).
// Unauthenticated requests are rejected with 401 Unauthorized.
// Cross-origin/CSRF checks are enforced on all protected requests.
func Auth(authService port.AuthService, staticToken string) gin.HandlerFunc {
	var expectedTokenHash [32]byte
	hasStaticToken := staticToken != ""
	if hasStaticToken {
		expectedTokenHash = sha256.Sum256([]byte("Bearer " + staticToken))
	}

	return func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		authHeader := c.GetHeader("Authorization")
		authorized := false

		// 1. Static operator token verification (constant time)
		queryToken := c.Query("token")
		if hasStaticToken {
			if strings.HasPrefix(authHeader, "Bearer ") {
				actual := sha256.Sum256([]byte(authHeader))
				if subtle.ConstantTimeCompare(expectedTokenHash[:], actual[:]) == 1 {
					authorized = true
					c.Set(CtxUserIDKey, "operator")
					c.Set(CtxUsernameKey, "operator")
					c.Set(CtxUserRoleKey, "admin")
				}
			} else if queryToken != "" {
				queryHash := sha256.Sum256([]byte("Bearer " + queryToken))
				if subtle.ConstantTimeCompare(expectedTokenHash[:], queryHash[:]) == 1 {
					authorized = true
					c.Set(CtxUserIDKey, "operator")
					c.Set(CtxUsernameKey, "operator")
					c.Set(CtxUserRoleKey, "admin")
				}
			}
		}

		// 2. JWT token verification (Bearer header, HttpOnly cookie, or URL query param)
		if !authorized && authService != nil {
			var token string
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimPrefix(authHeader, "Bearer ")
			} else if cookie, err := c.Cookie("aurora_token"); err == nil && cookie != "" {
				token = cookie
			} else if queryToken != "" {
				token = queryToken
			}

			if token != "" {
				claims, err := authService.ValidateToken(token)
				if err == nil && claims != nil {
					authorized = true
					c.Set(CtxUserIDKey, claims.Subject)
					c.Set(CtxUsernameKey, claims.Username)
					c.Set(CtxUserRoleKey, claims.Role)
				}
			}
		}

		if !authorized {
			if !hasStaticToken && authService == nil {
				c.String(http.StatusServiceUnavailable, "API credential not configured")
				c.Abort()
				return
			}
			c.String(http.StatusUnauthorized, "unauthorized")
			c.Abort()
			return
		}

		// 3. Origin & CSRF checks
		scheme := "http"
		if c.Request.TLS != nil {
			scheme = "https"
		}
		if origin := c.GetHeader("Origin"); origin != "" && origin != scheme+"://"+c.Request.Host {
			c.String(http.StatusForbidden, "cross-origin request rejected")
			c.Abort()
			return
		}
		if c.GetHeader("Sec-Fetch-Site") == "cross-site" {
			c.String(http.StatusForbidden, "cross-site request rejected")
			c.Abort()
			return
		}

		c.Next()
	}
}
