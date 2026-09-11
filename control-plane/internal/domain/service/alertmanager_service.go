package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// AlertmanagerService định nghĩa cổng dịch vụ giao tiếp với hệ sinh thái Alertmanager & Prometheus.
type AlertmanagerService interface {
	GetOverview(ctx context.Context) (*entity.AlertmanagerOverview, error)
	GetLiveRules(ctx context.Context) ([]entity.PrometheusRuleItem, error)
	GetFiringAlerts(ctx context.Context) ([]entity.PrometheusActiveAlert, error)
	GetSilences(ctx context.Context) ([]entity.AlertmanagerSilenceItem, error)
	CreateSilence(ctx context.Context, silence entity.AlertmanagerSilenceItem) (string, error)
	ExpireSilence(ctx context.Context, silenceID string) error
	GetConfig(ctx context.Context) (*entity.AlertmanagerSettings, error)
	UpdateConfig(ctx context.Context, settings entity.AlertmanagerSettings) error
}
