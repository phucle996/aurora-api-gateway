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
	updateSchemaFn func(ctx context.Context, cmd entity.UpdateExtensionSchemaCommand) error
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

func (m *mockExtensionRepo) UpdateSchema(ctx context.Context, cmd entity.UpdateExtensionSchemaCommand) error {
	if m.updateSchemaFn != nil {
		return m.updateSchemaFn(ctx, cmd)
	}
	return nil
}

func TestExtensionService_Validation(t *testing.T) {
	mockRepo := &mockExtensionRepo{}
	svc := service.NewExtensionService(mockRepo)
	ctx := context.Background()

	// Empty ID for GetExtension
	_, err := svc.GetExtension(ctx, "  ")
	if err == nil {
		t.Errorf("expected error on empty id, got nil")
	}

	// Empty ID for UpdateExtensionStatus
	err = svc.UpdateExtensionStatus(ctx, entity.UpdateExtensionStatusCommand{ID: ""})
	if err == nil {
		t.Errorf("expected error on empty id, got nil")
	}

	// Empty ID for UpdateExtensionConfig
	err = svc.UpdateExtensionConfig(ctx, entity.UpdateExtensionConfigCommand{ID: ""})
	if err == nil {
		t.Errorf("expected error on empty id, got nil")
	}

	// Invalid JSON for UpdateExtensionConfig
	err = svc.UpdateExtensionConfig(ctx, entity.UpdateExtensionConfigCommand{
		ID:         "test",
		ConfigJSON: "{invalid-json",
	})
	if err == nil {
		t.Errorf("expected error on invalid json, got nil")
	}

	// Valid JSON
	var updatedCmd entity.UpdateExtensionConfigCommand
	mockRepo.updateConfigFn = func(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
		updatedCmd = cmd
		return nil
	}

	err = svc.UpdateExtensionConfig(ctx, entity.UpdateExtensionConfigCommand{
		ID:         "test",
		ConfigJSON: `{"key": "value"}`,
	})
	if err != nil {
		t.Fatalf("unexpected error on valid json: %v", err)
	}
	if updatedCmd.ID != "test" || updatedCmd.ConfigJSON != `{"key": "value"}` {
		t.Errorf("unexpected command recorded: %+v", updatedCmd)
	}
}
