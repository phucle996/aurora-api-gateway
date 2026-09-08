package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
)

type AuthService interface {
	Login(ctx context.Context, input entity.LoginInput) (*entity.LoginOutput, error)
	Verify2FALogin(ctx context.Context, input entity.Verify2FALoginInput) (*entity.LoginOutput, error)
	ValidateToken(tokenString string) (*entity.Claims, error)
}
