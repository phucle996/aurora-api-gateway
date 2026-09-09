package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type extensionService struct {
	repo repo.ExtensionRepository
}

// NewExtensionService creates a new ExtensionService instance.
func NewExtensionService(repo repo.ExtensionRepository) *extensionService {
	return &extensionService{
		repo: repo,
	}
}

func (s *extensionService) ListExtensions(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
	q.Category = strings.TrimSpace(q.Category)
	q.Status = strings.TrimSpace(strings.ToLower(q.Status))
	return s.repo.List(ctx, q)
}

func (s *extensionService) GetExtension(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("extension id cannot be empty")
	}
	return s.repo.GetByID(ctx, id)
}

func (s *extensionService) UpdateExtensionStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
	cmd.ID = strings.TrimSpace(cmd.ID)
	if cmd.ID == "" {
		return fmt.Errorf("extension id cannot be empty")
	}
	return s.repo.UpdateStatus(ctx, cmd)
}

func (s *extensionService) UpdateExtensionConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
	cmd.ID = strings.TrimSpace(cmd.ID)
	if cmd.ID == "" {
		return fmt.Errorf("extension id cannot be empty")
	}

	configJSON := strings.TrimSpace(cmd.ConfigJSON)
	if configJSON == "" {
		configJSON = "{}"
	}

	if !json.Valid([]byte(configJSON)) {
		return fmt.Errorf("invalid json for extension config")
	}
	cmd.ConfigJSON = configJSON

	return s.repo.UpdateConfig(ctx, cmd)
}
