package config

import (
	"os"
	"strings"
)

var (
	DefaultVersion   = "dev"
	DefaultBuildTime = "unknown"
)

type GRPCConfig struct {
	Addr     string
	TLSMode  string // "plaintext", "tls", "mtls"
	CertFile string
	KeyFile  string
	ClientCA string
}

type Config struct {
	HTTPAddr       string
	SQLitePath     string
	AdminTokenFile string
	JWTSecret      string
	Version        string
	BuildTime      string
	TrustedProxies []string
	GRPC           GRPCConfig
}

func LoadConfig() Config {
	jwtSecret := os.Getenv("AURORA_JWT_SECRET")
	if jwtSecret == "" {
		panic("AURORA_JWT_SECRET environment variable is required and cannot be empty")
	}

	var trustedProxies []string
	if raw := os.Getenv("AURORA_TRUSTED_PROXIES"); raw != "" {
		for _, p := range strings.Split(raw, ",") {
			if trimmed := strings.TrimSpace(p); trimmed != "" {
				trustedProxies = append(trustedProxies, trimmed)
			}
		}
	}

	grpcTLSMode := strings.ToLower(strings.TrimSpace(value("AURORA_GRPC_TLS_MODE", "plaintext")))
	switch grpcTLSMode {
	case "", "plaintext":
		grpcTLSMode = "plaintext"
	case "tls", "mtls":
	default:
		panic("AURORA_GRPC_TLS_MODE must be one of: plaintext, tls, mtls; got " + grpcTLSMode)
	}

	var grpcCertFile, grpcKeyFile, grpcClientCA string
	if grpcTLSMode == "tls" || grpcTLSMode == "mtls" {
		grpcCertFile = os.Getenv("AURORA_GRPC_TLS_CERT")
		if grpcCertFile == "" {
			panic("AURORA_GRPC_TLS_CERT is required when AURORA_GRPC_TLS_MODE is " + grpcTLSMode)
		}
		if _, err := os.Stat(grpcCertFile); err != nil {
			panic("AURORA_GRPC_TLS_CERT file not found or inaccessible: " + grpcCertFile)
		}

		grpcKeyFile = os.Getenv("AURORA_GRPC_TLS_KEY")
		if grpcKeyFile == "" {
			panic("AURORA_GRPC_TLS_KEY is required when AURORA_GRPC_TLS_MODE is " + grpcTLSMode)
		}
		if _, err := os.Stat(grpcKeyFile); err != nil {
			panic("AURORA_GRPC_TLS_KEY file not found or inaccessible: " + grpcKeyFile)
		}
	}

	if grpcTLSMode == "mtls" {
		grpcClientCA = os.Getenv("AURORA_GRPC_TLS_CLIENT_CA")
		if grpcClientCA == "" {
			panic("AURORA_GRPC_TLS_CLIENT_CA is required when AURORA_GRPC_TLS_MODE is mtls")
		}
		if _, err := os.Stat(grpcClientCA); err != nil {
			panic("AURORA_GRPC_TLS_CLIENT_CA file not found or inaccessible: " + grpcClientCA)
		}
	}

	return Config{
		HTTPAddr:       value("AURORA_HTTP_ADDR", "127.0.0.1:8080"),
		SQLitePath:     value("AURORA_SQLITE_PATH", "data/aurora.db"),
		AdminTokenFile: os.Getenv("AURORA_ADMIN_TOKEN_FILE"),
		JWTSecret:      jwtSecret,
		Version:        value("AURORA_VERSION", DefaultVersion),
		BuildTime:      value("AURORA_BUILD_TIME", DefaultBuildTime),
		TrustedProxies: trustedProxies,
		GRPC: GRPCConfig{
			Addr:     value("AURORA_GRPC_ADDR", "0.0.0.0:9090"),
			TLSMode:  grpcTLSMode,
			CertFile: grpcCertFile,
			KeyFile:  grpcKeyFile,
			ClientCA: grpcClientCA,
		},
	}
}

func value(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
