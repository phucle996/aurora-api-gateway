package middleware

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/gin-gonic/gin"
)

const CtxRequestIDKey = "RequestID"
const HeaderRequestID = "X-Request-ID"

// RequestID là middleware quản lý header X-Request-ID cho mỗi request.
// Nếu client đã gửi X-Request-ID hợp lệ, nó sẽ được giữ nguyên;
// ngược lại, middleware sẽ tự động tạo một ID ngẫu nhiên 32 ký tự hex.
func RequestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		reqID := c.GetHeader(HeaderRequestID)
		if reqID == "" || len(reqID) > 128 {
			var b [16]byte
			_, _ = rand.Read(b[:])
			reqID = hex.EncodeToString(b[:])
		}

		c.Set(CtxRequestIDKey, reqID)
		c.Writer.Header().Set(HeaderRequestID, reqID)
		c.Next()
	}
}

// GetRequestID trích xuất RequestID từ gin context.
func GetRequestID(c *gin.Context) string {
	if val, ok := c.Get(CtxRequestIDKey); ok {
		if s, ok := val.(string); ok {
			return s
		}
	}
	return c.GetHeader(HeaderRequestID)
}
