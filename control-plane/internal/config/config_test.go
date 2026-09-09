package config_test

import (
	"os"
	"testing"

	"aurora-waf.local/control-plane/internal/config"
)

func TestLoadConfig_PanicsWhenJWTSecretEmpty(t *testing.T) {
	orig := os.Getenv("AURORA_JWT_SECRET")
	defer func() {
		_ = os.Setenv("AURORA_JWT_SECRET", orig)
	}()

	_ = os.Unsetenv("AURORA_JWT_SECRET")

	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("expected LoadConfig() to panic when AURORA_JWT_SECRET is empty, but it did not")
		}
	}()

	_ = config.LoadConfig()
}

func TestLoadConfig_UsesEnvDirectlyWithoutCheckOrFallback(t *testing.T) {
	orig := os.Getenv("AURORA_JWT_SECRET")
	defer func() {
		_ = os.Setenv("AURORA_JWT_SECRET", orig)
	}()

	customSecret := "custom-secret-key-123"
	_ = os.Setenv("AURORA_JWT_SECRET", customSecret)

	cfg := config.LoadConfig()
	if cfg.JWTSecret != customSecret {
		t.Fatalf("expected JWTSecret to be %q, got %q", customSecret, cfg.JWTSecret)
	}
}
