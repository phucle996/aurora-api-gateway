package service

import (
	"context"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
)

// ExtensionService manages dynamic extensions lifecycle and configuration.
type ExtensionService interface {
	ListExtensions(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error)
	GetExtension(ctx context.Context, id string) (*entity.ExtensionRecord, error)
	UpdateExtensionStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error
	UpdateExtensionConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error
}
