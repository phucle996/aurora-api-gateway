package service_test

import (
	"context"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/service"
)

type mockExtensionRepo struct {
	listFn         func(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error)
	getByIDFn      func(ctx context.Context, id string) (*entity.ExtensionRecord, error)
	updateStatusFn func(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error
	updateConfigFn func(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error
}

func (m *mockExtensionRepo) List(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
	if m.listFn != nil {
		return m.listFn(ctx, q)
	}
	return nil, nil
}

func (m *mockExtensionRepo) GetByID(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return nil, nil
}

func (m *mockExtensionRepo) UpdateStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
	if m.updateStatusFn != nil {
		return m.updateStatusFn(ctx, cmd)
	}
	return nil
}

func (m *mockExtensionRepo) UpdateConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
	if m.updateConfigFn != nil {
		return m.updateConfigFn(ctx, cmd)
	}
	return nil
}

func TestExtensionService_Validation(t *testing.T) {
	mockRepo := &mockExtensionRepo{
		getByIDFn: func(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
			return &entity.ExtensionRecord{
				ID:              id,
				ManifestKey:     "builtin/request-termination",
				ManifestVersion: 1,
			}, nil
		},
	}
	svc := service.NewExtensionService(mockRepo)
	ctx := context.Background()

	// Invalid JSON for UpdateExtensionConfig
	err := svc.UpdateExtensionConfig(ctx, entity.UpdateExtensionConfigCommand{
		ID:         "test",
		ConfigJSON: "{invalid-json",
	})
	if err == nil {
		t.Errorf("expected error on invalid json, got nil")
	}

	// Valid JSON is validated by its immutable manifest and canonicalized.
	var updatedCmd entity.UpdateExtensionConfigCommand
	mockRepo.updateConfigFn = func(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
		updatedCmd = cmd
		return nil
	}

	err = svc.UpdateExtensionConfig(ctx, entity.UpdateExtensionConfigCommand{
		ID:         "test",
		ConfigJSON: `{"body":"Planned maintenance","status_code":503}`,
	})
	if err != nil {
		t.Fatalf("unexpected error on valid json: %v", err)
	}
	if updatedCmd.ID != "test" || updatedCmd.ConfigJSON != `{"body":"Planned maintenance","status_code":503}` {
		t.Errorf("unexpected command recorded: %+v", updatedCmd)
	}

}

func TestExtensionService_RejectsUnconfiguredJWTEnable(t *testing.T) {
	mockRepo := &mockExtensionRepo{
		getByIDFn: func(context.Context, string) (*entity.ExtensionRecord, error) {
			return &entity.ExtensionRecord{
				ID:              "jwt-authentication",
				ManifestKey:     "builtin/jwt-authentication",
				ManifestVersion: 1,
				ConfigJSON:      `{"rules":[]}`,
			}, nil
		},
		updateStatusFn: func(context.Context, entity.UpdateExtensionStatusCommand) error {
			t.Fatal("repository must not receive an unconfigured JWT enable")
			return nil
		},
	}

	err := service.NewExtensionService(mockRepo).UpdateExtensionStatus(context.Background(), entity.UpdateExtensionStatusCommand{
		ID:      "jwt-authentication",
		Enabled: true,
	})
	if err == nil {
		t.Fatal("expected JWT enable without rules to fail")
	}
}
