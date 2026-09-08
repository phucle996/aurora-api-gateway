package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

func TestLoginRateLimiter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	limiter := middleware.NewLoginRateLimiter(3, 100*time.Millisecond)

	r := gin.New()
	r.POST("/login", limiter.Handler(), func(c *gin.Context) {
		c.String(http.StatusOK, "login-ok")
	})

	// 3 lần request đầu tiên phải thành công (200 OK)
	for i := 1; i <= 3; i++ {
		req := httptest.NewRequest(http.MethodPost, "/login", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("attempt %d expected 200 OK, got %d", i, w.Code)
		}
	}

	// Lần thứ 4 trong cửa sổ thời gian phải bị chặn (429 Too Many Requests)
	req4 := httptest.NewRequest(http.MethodPost, "/login", nil)
	w4 := httptest.NewRecorder()
	r.ServeHTTP(w4, req4)
	if w4.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt 4 expected 429 Too Many Requests, got %d", w4.Code)
	}
	if retryAfter := w4.Header().Get("Retry-After"); retryAfter == "" {
		t.Error("expected Retry-After header on 429 response")
	}

	// Chờ hết cửa sổ thời gian (100ms), request tiếp theo phải thành công trở lại
	time.Sleep(120 * time.Millisecond)

	req5 := httptest.NewRequest(http.MethodPost, "/login", nil)
	w5 := httptest.NewRecorder()
	r.ServeHTTP(w5, req5)
	if w5.Code != http.StatusOK {
		t.Fatalf("attempt 5 after window expected 200 OK, got %d", w5.Code)
	}
}
