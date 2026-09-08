package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

func TestRequestIDMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(middleware.RequestID())

	var capturedContextID string
	r.GET("/test", func(c *gin.Context) {
		capturedContextID = middleware.GetRequestID(c)
		c.String(http.StatusOK, "ok")
	})

	// 1. Tự động sinh ID mới nếu client không gửi header
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	respHeaderID := w.Header().Get("X-Request-ID")
	if respHeaderID == "" {
		t.Fatal("expected X-Request-ID header in response")
	}
	if len(respHeaderID) != 32 {
		t.Errorf("expected 32-char hex string, got %s", respHeaderID)
	}
	if capturedContextID != respHeaderID {
		t.Errorf("expected context ID %s to match header ID %s", capturedContextID, respHeaderID)
	}

	// 2. Bảo lưu ID hợp lệ nếu client đã cung cấp sẵn
	customID := "client-trace-id-12345"
	reqCustom := httptest.NewRequest(http.MethodGet, "/test", nil)
	reqCustom.Header.Set("X-Request-ID", customID)
	wCustom := httptest.NewRecorder()
	r.ServeHTTP(wCustom, reqCustom)

	if wCustom.Header().Get("X-Request-ID") != customID {
		t.Errorf("expected preserved custom ID %s, got %s", customID, wCustom.Header().Get("X-Request-ID"))
	}
}
