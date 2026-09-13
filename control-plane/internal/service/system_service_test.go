package service_test

import (
	"context"
	"testing"

	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/service"
)

type mockSystemRepo struct{}

func (m *mockSystemRepo) Check(ctx context.Context) error {
	return nil
}

func TestSystemService_GetSystemInfo(t *testing.T) {
	mockRepo := &mockSystemRepo{}
	cfg := config.Config{
		SQLitePath: "/non-existent/path.db",
		Version:    "v2.0.0",
		BuildTime:  "2026-10-01 12:00:00",
	}

	svc := service.NewSystemService(mockRepo, cfg)
	info, err := svc.GetSystemInfo(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if info.Version != "v2.0.0" {
		t.Errorf("expected version v2.0.0, got %s", info.Version)
	}

	// Test with empty version / buildTime to verify fallback to config defaults
	emptyCfg := config.Config{
		SQLitePath: "/non-existent/path.db",
	}
	defaultSvc := service.NewSystemService(mockRepo, emptyCfg)
	defaultInfo, err := defaultSvc.GetSystemInfo(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if defaultInfo.Version != config.DefaultVersion {
		t.Errorf("expected default version %s, got %s", config.DefaultVersion, defaultInfo.Version)
	}
}
