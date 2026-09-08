package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// SystemService định nghĩa port dịch vụ nghiệp vụ cung cấp thông tin hệ thống.
type SystemService interface {
	GetSystemInfo(ctx context.Context) (*entity.SystemInfo, error)
}
