package service

import (
	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
	"context"
)

type AuthService interface {
	Login(ctx context.Context, input entity.LoginInput) (*entity.LoginOutput, error)
	Verify2FALogin(ctx context.Context, input entity.Verify2FALoginInput) (*entity.LoginOutput, error)
	ValidateToken(tokenString string) (*entity.Claims, error)
}
