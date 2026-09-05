package repo

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type AuthRepository interface {
	FindByUsername(ctx context.Context, username string) (*entity.User, error)
}
