package config_test

import (
	"os"
	"testing"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/config"
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

func TestLoadConfig_GRPCTLSModes(t *testing.T) {
	origSecret := os.Getenv("AURORA_JWT_SECRET")
	origMode := os.Getenv("AURORA_GRPC_TLS_MODE")
	origCert := os.Getenv("AURORA_GRPC_TLS_CERT")
	origKey := os.Getenv("AURORA_GRPC_TLS_KEY")
	origCA := os.Getenv("AURORA_GRPC_TLS_CLIENT_CA")
	defer func() {
		_ = os.Setenv("AURORA_JWT_SECRET", origSecret)
		_ = os.Setenv("AURORA_GRPC_TLS_MODE", origMode)
		_ = os.Setenv("AURORA_GRPC_TLS_CERT", origCert)
		_ = os.Setenv("AURORA_GRPC_TLS_KEY", origKey)
		_ = os.Setenv("AURORA_GRPC_TLS_CLIENT_CA", origCA)
	}()

	_ = os.Setenv("AURORA_JWT_SECRET", "test-secret")

	// 1. Default mode is plaintext
	_ = os.Unsetenv("AURORA_GRPC_TLS_MODE")
	cfg := config.LoadConfig()
	if cfg.GRPC.TLSMode != "plaintext" || cfg.GRPC.Addr != "0.0.0.0:9090" {
		t.Fatalf("expected default mode plaintext and default addr, got %+v", cfg.GRPC)
	}

	// 2. Invalid mode panics
	_ = os.Setenv("AURORA_GRPC_TLS_MODE", "invalid-mode")
	assertPanic(t, "expected panic on invalid mode", func() {
		_ = config.LoadConfig()
	})

	// 3. Mode tls without cert panics
	_ = os.Setenv("AURORA_GRPC_TLS_MODE", "tls")
	_ = os.Unsetenv("AURORA_GRPC_TLS_CERT")
	_ = os.Unsetenv("AURORA_GRPC_TLS_KEY")
	assertPanic(t, "expected panic on missing cert", func() {
		_ = config.LoadConfig()
	})

	// 4. Mode tls with non-existent cert file panics
	_ = os.Setenv("AURORA_GRPC_TLS_CERT", "/non/existent/cert.pem")
	_ = os.Setenv("AURORA_GRPC_TLS_KEY", "/non/existent/key.pem")
	assertPanic(t, "expected panic on non-existent cert file", func() {
		_ = config.LoadConfig()
	})

	// Create temporary dummy files
	tempDir := t.TempDir()
	certPath := tempDir + "/server.crt"
	keyPath := tempDir + "/server.key"
	caPath := tempDir + "/ca.crt"
	_ = os.WriteFile(certPath, []byte("dummy-cert"), 0600)
	_ = os.WriteFile(keyPath, []byte("dummy-key"), 0600)
	_ = os.WriteFile(caPath, []byte("dummy-ca"), 0600)

	// 5. Mode tls with valid files succeeds
	_ = os.Setenv("AURORA_GRPC_TLS_CERT", certPath)
	_ = os.Setenv("AURORA_GRPC_TLS_KEY", keyPath)
	cfg = config.LoadConfig()
	if cfg.GRPC.TLSMode != "tls" || cfg.GRPC.CertFile != certPath || cfg.GRPC.KeyFile != keyPath {
		t.Fatalf("unexpected tls config: %+v", cfg.GRPC)
	}

	// 6. Mode mtls without client CA panics
	_ = os.Setenv("AURORA_GRPC_TLS_MODE", "mtls")
	_ = os.Unsetenv("AURORA_GRPC_TLS_CLIENT_CA")
	assertPanic(t, "expected panic on mtls missing client CA", func() {
		_ = config.LoadConfig()
	})

	// 7. Mode mtls with valid client CA succeeds
	_ = os.Setenv("AURORA_GRPC_TLS_CLIENT_CA", caPath)
	cfg = config.LoadConfig()
	if cfg.GRPC.TLSMode != "mtls" || cfg.GRPC.ClientCA != caPath {
		t.Fatalf("unexpected mtls config: %+v", cfg.GRPC)
	}
}

func assertPanic(t *testing.T, msg string, fn func()) {
	t.Helper()
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal(msg)
		}
	}()
	fn()
}
