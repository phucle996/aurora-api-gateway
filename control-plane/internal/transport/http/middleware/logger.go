package middleware

import (
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// AccessLogger là middleware ghi log HTTP access log có cấu trúc cho Control Plane.
// Tự động bỏ qua các endpoint kiểm tra liveness/readiness định kỳ khi trả về HTTP 200 để tránh spam log.
func AccessLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		rawQuery := c.Request.URL.RawQuery

		c.Next()

		status := c.Writer.Status()

		// Bỏ qua health checks nếu status thành công để tránh làm ngập log
		if (path == "/healthz" || path == "/readyz") && status == 200 {
			return
		}

		latency := time.Since(start)
		clientIP := c.ClientIP()
		method := c.Request.Method
		reqID := GetRequestID(c)

		fullPath := path
		if rawQuery != "" {
			fullPath = path + "?" + rawQuery
		}

		log.Printf("[HTTP] %s | %3d | %12v | %s | %s %-7s %s",
			reqID,
			status,
			latency,
			clientIP,
			method,
			fullPath,
			c.Errors.ByType(gin.ErrorTypePrivate).String(),
		)
	}
}
