package app_test

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
)

func TestNewApp_ProductionSecurityFailFast(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test_prod.db")

	// 1. Chạy với AURORA_ENV=production nhưng giữ JWT Secret mặc định -> Phải fail-fast
	cfgDefaultSecret := config.Config{
		Env:        "production",
		SQLitePath: dbPath,
		JWTSecret:  config.DefaultJWTSecret,
	}

	_, err := app.NewApp(context.Background(), cfgDefaultSecret)
	if err == nil {
		t.Fatal("expected NewApp to fail in production with default JWT secret, but got nil")
	}
	if !strings.Contains(err.Error(), "requires a custom AURORA_JWT_SECRET") {
		t.Fatalf("unexpected error message: %v", err)
	}

	// 2. Chạy với AURORA_ENV=production nhưng JWT Secret quá ngắn (< 32 ký tự) -> Phải fail-fast
	cfgShortSecret := config.Config{
		Env:        "production",
		SQLitePath: dbPath,
		JWTSecret:  "short-secret-less-than-32-chars",
	}

	_, err = app.NewApp(context.Background(), cfgShortSecret)
	if err == nil {
		t.Fatal("expected NewApp to fail in production with short JWT secret, but got nil")
	}

	// 3. Chạy với AURORA_ENV=production và JWT Secret hợp lệ (>= 32 ký tự, không phải mặc định) -> Thành công
	cfgValid := config.Config{
		Env:        "production",
		SQLitePath: dbPath,
		JWTSecret:  "a-very-strong-production-jwt-secret-at-least-32-chars-long",
	}

	a, err := app.NewApp(context.Background(), cfgValid)
	if err != nil {
		t.Fatalf("expected NewApp to succeed with valid production secret, got error: %v", err)
	}
	defer a.Close()
}
