package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
)

type NotificationService = port.NotificationService

type notificationService struct {
	repo     repo.NotificationRepository
	provider provider.NotificationProvider
	worker   *NotificationWorker
}

// NewNotificationService khởi tạo service quản lý cấu hình thông báo, test channel và dispatch cảnh báo.
func NewNotificationService(
	repo repo.NotificationRepository,
	provider provider.NotificationProvider,
	worker *NotificationWorker,
) NotificationService {
	return &notificationService{
		repo:     repo,
		provider: provider,
		worker:   worker,
	}
}

func (s *notificationService) GetOverview(ctx context.Context) (*entity.NotificationOverview, error) {
	return s.repo.GetOverview(ctx)
}

func (s *notificationService) UpdateChannel(ctx context.Context, id string, enabled bool, configJSON string) error {
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" {
		return errors.New("channel ID không được để trống")
	}

	if configJSON == "" {
		configJSON = "{}"
	}
	if !json.Valid([]byte(configJSON)) {
		return errors.New("cấu hình channel phải là định dạng JSON hợp lệ")
	}

	return s.repo.UpdateChannel(ctx, id, enabled, configJSON)
}

func (s *notificationService) UpdateRule(ctx context.Context, id string, enabled bool) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("rule ID không được để trống")
	}
	return s.repo.UpdateRule(ctx, id, enabled)
}

func (s *notificationService) TestChannel(ctx context.Context, id string) (*entity.TestNotificationResult, error) {
	id = strings.ToLower(strings.TrimSpace(id))
	channel, err := s.repo.GetChannelByID(ctx, id)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	testErr, testMsg := s.provider.Test(id, channel.ConfigJSON)
	latency := time.Since(start).Milliseconds()

	status := "success"
	if testErr != nil {
		status = "failed"
		testMsg = testErr.Error()
	}

	_ = s.repo.RecordTestResult(ctx, id, status, testMsg)

	if testErr != nil {
		return &entity.TestNotificationResult{
			Success:   false,
			Message:   testMsg,
			LatencyMs: latency,
		}, nil
	}

	return &entity.TestNotificationResult{
		Success:   true,
		Message:   testMsg,
		LatencyMs: latency,
	}, nil
}

func (s *notificationService) DispatchAlert(event entity.AlertEvent) bool {
	if s.worker == nil {
		return false
	}
	return s.worker.Enqueue(event)
}
