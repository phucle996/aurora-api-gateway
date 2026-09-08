package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type AuthRepository interface {
	FindByUsername(ctx context.Context, username string) (*entity.User, error)
	FindByID(ctx context.Context, id string) (*entity.User, error)
	UpdateRecoveryCodes(ctx context.Context, id string, codesJSON string) error
}
