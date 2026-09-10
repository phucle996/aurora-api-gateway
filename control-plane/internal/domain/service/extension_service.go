package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// ExtensionService manages dynamic extensions lifecycle and configuration.
type ExtensionService interface {
	ListExtensions(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error)
	GetExtension(ctx context.Context, id string) (*entity.ExtensionRecord, error)
	UpdateExtensionStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error
	UpdateExtensionConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error
	UpdateExtensionSchema(ctx context.Context, cmd entity.UpdateExtensionSchemaCommand) error
}
