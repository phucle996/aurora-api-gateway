package config

import "os"

const DefaultJWTSecret = "aurora-waf-jwt-secret-key-production-32b-fixed"

type Config struct {
	HTTPAddr       string
	SQLitePath     string
	AdminTokenFile string
	CompilerPath     string
	JWTSecret        string
	RateLimitUDPAddr string
}

func LoadConfig() Config {
	return Config{
		HTTPAddr:         value("AURORA_HTTP_ADDR", "127.0.0.1:8080"),
		SQLitePath:       value("AURORA_SQLITE_PATH", "data/aurora.db"),
		AdminTokenFile:   os.Getenv("AURORA_ADMIN_TOKEN_FILE"),
		CompilerPath:     os.Getenv("AURORA_COMPILER_PATH"),
		JWTSecret:        value("AURORA_JWT_SECRET", DefaultJWTSecret),
		RateLimitUDPAddr: value("AURORA_RATE_LIMIT_UDP", "127.0.0.1:5140"),
	}
}

func value(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
