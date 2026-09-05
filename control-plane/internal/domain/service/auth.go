package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type AuthService interface {
	Login(ctx context.Context, input entity.LoginInput) (*entity.LoginOutput, error)
	ValidateToken(tokenString string) (*entity.Claims, error)
}
