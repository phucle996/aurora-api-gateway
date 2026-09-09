package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
)

var (
	version   string
	buildTime string
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	if version != "" {
		config.DefaultVersion = version
	}
	if buildTime != "" {
		config.DefaultBuildTime = buildTime
	}
	cfg := config.LoadConfig()

	a, err := app.NewApp(ctx, cfg)
	if err != nil {
		return err
	}
	defer a.Close()
	log.Printf("Aurora development controller listening on %s", cfg.HTTPAddr)
	return a.Run(ctx)
}
