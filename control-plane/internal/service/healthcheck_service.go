package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainservice "aurora-waf.local/control-plane/internal/domain/service"
)

// healthcheckService chịu trách nhiệm cung cấp thông tin trạng thái hoạt động và
// thực hiện kiểm tra mức độ sẵn sàng (Healthcheck & Readiness probe) của hệ thống control-plane.
type healthcheckService struct {
	storage repo.StorageRepository
}

// NewHealthcheckService khởi tạo dịch vụ HealthcheckService,
// nhận vào repo.StorageRepository và trả về interface domainservice.HealthcheckService.
func NewHealthcheckService(storage repo.StorageRepository) domainservice.HealthcheckService {
	return &healthcheckService{
		storage: storage,
	}
}

// Status trả về thông tin trạng thái hoạt động hiện tại của bộ điều khiển Aurora WAF.
func (s *healthcheckService) Status() entity.ControllerStatus {
	return entity.ControllerStatus{
		Component:        "aurora-controller",
		Stage:            "foundation",
		EnforcementReady: nil,
		Message:          "Embedded console available; controller does not observe NGINX node enforcement",
	}
}

// Ready kiểm tra xem hệ thống đã sẵn sàng phục vụ lưu lượng truy cập hay chưa (Readiness Probe).
func (s *healthcheckService) Ready(ctx context.Context) error {
	return s.storage.Check(ctx)
}
