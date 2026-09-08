package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

func TestAuthMiddleware_ReverseProxyHTTPS(t *testing.T) {
	gin.SetMode(gin.TestMode)
	staticToken := "test-static-operator-token-at-least-32-bytes"

	r := gin.New()
	r.Use(middleware.Auth(nil, staticToken))
	r.GET("/protected", func(c *gin.Context) {
		c.String(http.StatusOK, "protected-ok")
	})

	// 1. Request có Origin https://waf.example.com nhưng kết nối tới controller là HTTP (TLS offload bởi reverse proxy)
	// Kèm theo header X-Forwarded-Proto: https -> Phải được chấp nhận (200 OK)
	req := httptest.NewRequest(http.MethodGet, "http://waf.example.com/protected", nil)
	req.Header.Set("Authorization", "Bearer "+staticToken)
	req.Header.Set("Origin", "https://waf.example.com")
	req.Header.Set("X-Forwarded-Proto", "https")

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for HTTPS reverse proxy with matching origin, got %d: %s", w.Code, w.Body.String())
	}

	// 2. Request từ origin lạ (cross-site) -> Bị từ chối 403 Forbidden
	reqBadOrigin := httptest.NewRequest(http.MethodGet, "http://waf.example.com/protected", nil)
	reqBadOrigin.Header.Set("Authorization", "Bearer "+staticToken)
	reqBadOrigin.Header.Set("Origin", "https://attacker.evil.com")
	reqBadOrigin.Header.Set("X-Forwarded-Proto", "https")

	wBad := httptest.NewRecorder()
	r.ServeHTTP(wBad, reqBadOrigin)

	if wBad.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for cross-origin request, got %d", wBad.Code)
	}
}
