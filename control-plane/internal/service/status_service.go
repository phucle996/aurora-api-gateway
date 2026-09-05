package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainservice "aurora-waf.local/control-plane/internal/domain/service"
	"context"
)

// statusService chịu trách nhiệm cung cấp thông tin trạng thái của bộ điều khiển (Controller Status)
// và thực hiện kiểm tra mức độ sẵn sàng (Readiness probe) của toàn bộ hệ thống control-plane.
type statusService struct {
	storage repo.StorageRepository // Interface port kết nối tới tầng lưu trữ để kiểm tra sức khỏe CSDL
}

// NewStatusService là constructor khởi tạo dịch vụ StatusService,
// nhận vào repo.StorageRepository và trả về interface domainservice.StatusService.
func NewStatusService(storage repo.StorageRepository) domainservice.StatusService {
	return &statusService{
		storage: storage,
	}
}

// Status trả về thông tin trạng thái hoạt động hiện tại của bộ điều khiển Aurora WAF.
// Cung cấp tên thành phần (Component), giai đoạn phát triển (Stage) và thông báo hệ thống (Message).
func (s *statusService) Status() entity.ControllerStatus {
	return entity.ControllerStatus{
		Component:        "aurora-controller",
		Stage:            "foundation",
		EnforcementReady: nil,
		Message:          "Embedded console available; controller does not observe NGINX node enforcement",
	}
}

// Ready kiểm tra xem hệ thống đã sẵn sàng phục vụ lưu lượng truy cập hay chưa (Readiness Probe).
// Phương thức này ủy thác việc kiểm tra cho tầng repository để xác nhận CSDL vẫn đang kết nối
// và đã hoàn tất khởi tạo schema di trú ban đầu.
func (s *statusService) Ready(ctx context.Context) error {
	return s.storage.Check(ctx)
}
