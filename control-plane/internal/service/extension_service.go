package service

import (
	"context"
	"fmt"
	"strings"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/extensionmanifest"
)

type extensionService struct {
	repo       repo.ExtensionRepository
	onMutation func()
}

// NewExtensionService creates a new ExtensionService instance with optional mutation callback.
func NewExtensionService(repo repo.ExtensionRepository, onMutation ...func()) *extensionService {
	var fn func()
	if len(onMutation) > 0 {
		fn = onMutation[0]
	}
	return &extensionService{
		repo:       repo,
		onMutation: fn,
	}
}

func (s *extensionService) notifyMutation() {
	if s.onMutation != nil {
		s.onMutation()
	}
}

func (s *extensionService) ListExtensions(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
	q.Category = strings.TrimSpace(q.Category)
	q.Status = strings.TrimSpace(strings.ToLower(q.Status))
	category := q.Category
	q.Category = ""
	records, err := s.repo.List(ctx, q)
	if err != nil {
		return nil, err
	}
	filtered := records[:0]
	for i := range records {
		s.decorate(&records[i])
		if category == "" || records[i].Category == category {
			filtered = append(filtered, records[i])
		}
	}
	return filtered, nil
}

func (s *extensionService) GetExtension(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, fmt.Errorf("extension id cannot be empty")
	}
	record, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	s.decorate(record)
	return record, nil
}

func (s *extensionService) UpdateExtensionStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
	cmd.ID = strings.TrimSpace(cmd.ID)
	if cmd.ID == "" {
		return fmt.Errorf("extension id cannot be empty")
	}
	record, err := s.GetExtension(ctx, cmd.ID)
	if err != nil {
		return err
	}
	if cmd.Enabled && !record.Supported {
		return fmt.Errorf("extension %q is not installed on this release", cmd.ID)
	}
	if cmd.Enabled {
		manifest, ok := extensionmanifest.Find(record.ManifestKey, record.ManifestVersion)
		if !ok {
			return fmt.Errorf("extension manifest %s@%d is unavailable", record.ManifestKey, record.ManifestVersion)
		}
		if err := extensionmanifest.ValidateForEnable(manifest, record.ConfigJSON); err != nil {
			return fmt.Errorf("extension %q cannot be enabled: %w", cmd.ID, err)
		}
	}
	if err := s.repo.UpdateStatus(ctx, cmd); err != nil {
		return err
	}
	s.notifyMutation()
	return nil
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

	record, err := s.GetExtension(ctx, cmd.ID)
	if err != nil {
		return err
	}
	if !record.Supported {
		return fmt.Errorf("extension %q is not installed on this release", cmd.ID)
	}
	manifest, ok := extensionmanifest.Find(record.ManifestKey, record.ManifestVersion)
	if !ok {
		return fmt.Errorf("extension manifest %s@%d is unavailable", record.ManifestKey, record.ManifestVersion)
	}
	canonical, err := extensionmanifest.ValidateConfig(manifest, configJSON)
	if err != nil {
		return fmt.Errorf("invalid config for %s: %w", cmd.ID, err)
	}
	cmd.ConfigJSON = canonical

	if err := s.repo.UpdateConfig(ctx, cmd); err != nil {
		return err
	}
	s.notifyMutation()
	return nil
}

func (s *extensionService) decorate(record *entity.ExtensionRecord) {
	manifest, ok := extensionmanifest.Find(record.ManifestKey, record.ManifestVersion)
	if !ok {
		record.Supported = false
		return
	}
	digest, err := extensionmanifest.Digest()
	if err != nil {
		return
	}
	record.ManifestDigest = digest
	record.Name = manifest.Name
	record.Category = manifest.Category
	record.Description = manifest.Description
	record.ConfigSchemaJSON = string(manifest.ConfigSchema)
	record.UISchemaJSON = string(manifest.UISchema)
	record.Supported = true
	record.IsBuiltin = manifest.Builtin
}
