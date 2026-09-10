package config

import (
	"os"
	"strings"
)

var (
	DefaultVersion   = "dev"
	DefaultBuildTime = "unknown"
)

type Config struct {
	Env              string
	HTTPAddr         string
	GRPCAddr         string
	SQLitePath       string
	AdminTokenFile   string
	CompilerPath     string
	JWTSecret        string
	RateLimitUDPAddr string
	Version          string
	BuildTime        string
	TrustedProxies   []string
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

	return Config{
		Env:              value("AURORA_ENV", "development"),
		HTTPAddr:         value("AURORA_HTTP_ADDR", "127.0.0.1:8080"),
		GRPCAddr:         value("AURORA_GRPC_ADDR", "0.0.0.0:9090"),
		SQLitePath:       value("AURORA_SQLITE_PATH", "data/aurora.db"),
		AdminTokenFile:   os.Getenv("AURORA_ADMIN_TOKEN_FILE"),
		CompilerPath:     os.Getenv("AURORA_COMPILER_PATH"),
		JWTSecret:        jwtSecret,
		RateLimitUDPAddr: value("AURORA_RATE_LIMIT_UDP", "127.0.0.1:5140"),
		Version:          value("AURORA_VERSION", DefaultVersion),
		BuildTime:        value("AURORA_BUILD_TIME", DefaultBuildTime),
		TrustedProxies:   trustedProxies,
	}
}

func value(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
