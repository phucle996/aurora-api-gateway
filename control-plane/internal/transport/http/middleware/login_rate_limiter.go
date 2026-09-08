package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type ipHistory struct {
	timestamps []time.Time
}

// LoginRateLimiter bảo vệ endpoint login khỏi tấn công brute-force và credential stuffing.
type LoginRateLimiter struct {
	mu          sync.Mutex
	history     map[string]*ipHistory
	maxAttempts int
	window      time.Duration
}

// NewLoginRateLimiter khởi tạo rate limiter với số lần thử tối đa trong một khoảng thời gian.
func NewLoginRateLimiter(maxAttempts int, window time.Duration) *LoginRateLimiter {
	l := &LoginRateLimiter{
		history:     make(map[string]*ipHistory),
		maxAttempts: maxAttempts,
		window:      window,
	}

	// Chạy goroutine dọn dẹp định kỳ để tránh rò rỉ bộ nhớ
	go l.cleanupLoop()

	return l
}

func (l *LoginRateLimiter) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for now := range ticker.C {
		l.mu.Lock()
		cutoff := now.Add(-l.window)
		for ip, hist := range l.history {
			validIdx := 0
			for _, t := range hist.timestamps {
				if t.After(cutoff) {
					break
				}
				validIdx++
			}
			hist.timestamps = hist.timestamps[validIdx:]
			if len(hist.timestamps) == 0 {
				delete(l.history, ip)
			}
		}
		l.mu.Unlock()
	}
}

// Handler trả về gin.HandlerFunc áp dụng giới hạn request đăng nhập.
func (l *LoginRateLimiter) Handler() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		now := time.Now()

		l.mu.Lock()
		hist, exists := l.history[ip]
		if !exists {
			hist = &ipHistory{}
			l.history[ip] = hist
		}

		// Loại bỏ các mốc thời gian ngoài cửa sổ trượt
		cutoff := now.Add(-l.window)
		valid := make([]time.Time, 0, len(hist.timestamps))
		for _, t := range hist.timestamps {
			if t.After(cutoff) {
				valid = append(valid, t)
			}
		}
		hist.timestamps = valid

		if len(hist.timestamps) >= l.maxAttempts {
			l.mu.Unlock()
			retrySec := int(l.window.Seconds())
			if retrySec <= 0 {
				retrySec = 60
			}
			c.Header("Retry-After", strconv.Itoa(retrySec))
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many login attempts. Please try again later.",
			})
			c.Abort()
			return
		}

		hist.timestamps = append(hist.timestamps, now)
		l.mu.Unlock()

		c.Next()
	}
}
