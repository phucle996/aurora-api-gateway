package integration_test

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
)

// Test-only scheduling gate around REAL SQLite commit. It makes a valid
// concurrent Save interleaving deterministic, without replacing storage.
type metricsAuditSaveGate struct {
	repo.SettingsRepository
	committed chan struct{}
	resume    chan struct{}
}

func (g *metricsAuditSaveGate) SaveMetricsConfig(ctx context.Context, c entity.MetricsIntegrationConfig) error {
	if err := g.SettingsRepository.SaveMetricsConfig(ctx, c); err != nil {
		return err
	}
	if c.Mode == "standalone" {
		close(g.committed)
		<-g.resume
	}
	return nil
}

func TestAuditMetricsConcurrentConfigDurableAuthority(t *testing.T) {
	if os.Getenv("AURORA_METRICS_AUDIT") != "1" {
		t.Skip("opt-in correctness audit; may expose known failures")
	}
	dbPath := filepath.Join(t.TempDir(), "audit.db")
	a, err := app.NewApp(context.Background(), config.Config{SQLitePath: dbPath})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()
	pools, err := infra.OpenSQLitePool(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()
	durable := repository.NewSettingsRepository(pools.Writer)
	gate := &metricsAuditSaveGate{SettingsRepository: durable, committed: make(chan struct{}), resume: make(chan struct{})}
	s := service.NewMetricsService(gate, repository.NewNodeRepository(pools.Writer))
	first := make(chan error, 1)
	go func() {
		first <- s.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: "standalone"})
	}()
	select {
	case <-gate.committed:
	case <-time.After(3 * time.Second):
		t.Fatal("first commit timeout")
	}
	second := make(chan error, 1)
	go func() {
		second <- s.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: "disabled"})
	}()
	select {
	case err = <-second:
		close(gate.resume)
		<-first
		t.Fatalf("second mutation bypassed serialized transition: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(gate.resume)
	if err = <-first; err != nil {
		t.Fatal(err)
	}
	if err = <-second; err != nil {
		t.Fatal(err)
	}
	defer s.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: "disabled"})
	cfg, err := durable.GetMetricsConfig(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_, runtimeErr := s.GetNodeMetrics(context.Background(), "node-local-01")
	if cfg.Mode != "disabled" || !errors.Is(runtimeErr, taxonomy.ErrMetricsDisabled) {
		t.Errorf("durable mode=%s but runtime error=%v; later SQLite commit must win both durable and active state", cfg.Mode, runtimeErr)
	}
}

func TestAuditStandaloneRollupSurvivesRequestCancellation(t *testing.T) {
	if os.Getenv("AURORA_METRICS_AUDIT") != "1" {
		t.Skip("opt-in 65s durable rollup audit")
	}
	dbPath := filepath.Join(t.TempDir(), "rollup.db")
	a, err := app.NewApp(context.Background(), config.Config{SQLitePath: dbPath})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()
	pools, err := infra.OpenSQLitePool(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()
	s := service.NewMetricsService(repository.NewSettingsRepository(pools.Writer), repository.NewNodeRepository(pools.Writer))
	ctx, cancel := context.WithCancel(context.Background())
	if err = s.SaveConfig(ctx, entity.MetricsIntegrationConfig{Mode: "standalone"}); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel() // net/http cancels request context when the settings response completes.
	defer s.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: "disabled"})
	until := time.Now().Add(65 * time.Second)
	for time.Now().Before(until) {
		s.PushMetricPoint("node-local-01", entity.NodeMetricPoint{Timestamp: time.Now().Unix(), CPUUsage: 12, MemoryUsage: 34, RPS: 5000})
		time.Sleep(100 * time.Millisecond)
	}
	var count int
	if err = pools.Reader.QueryRow("SELECT count(*) FROM node_metrics_history").Scan(&count); err != nil {
		t.Fatal(err)
	}
	points, err := s.GetNodeMetrics(context.Background(), "node-local-01")
	if err != nil {
		t.Fatal(err)
	}
	if len(points) > 60 {
		t.Errorf("ring exceeds bound: %d", len(points))
	}
	if count == 0 {
		t.Errorf("%d RAM points but no durable rollup after 65s; request cancellation stopped the provider background worker", len(points))
	}
}

func TestAuditMetricsStaleHeartbeatNotReady(t *testing.T) {
	if os.Getenv("AURORA_METRICS_AUDIT") != "1" {
		t.Skip("opt-in stale-liveness audit")
	}
	dbPath := filepath.Join(t.TempDir(), "stale.db")
	a, err := app.NewApp(context.Background(), config.Config{SQLitePath: dbPath})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()
	pools, err := infra.OpenSQLitePool(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()
	nodeRepo := repository.NewNodeRepository(pools.Writer)
	metrics := service.NewMetricsService(repository.NewSettingsRepository(pools.Writer), nodeRepo)
	nodes := service.NewNodeService(nodeRepo, metrics)
	defer metrics.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: "disabled"})
	for _, mode := range []string{"disabled", "standalone", "prometheus"} {
		if err = metrics.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: mode, PrometheusURL: "http://127.0.0.1:1"}); err != nil {
			t.Fatal(err)
		}
		if _, err = nodes.RecordHeartbeat(context.Background(), entity.NodeHeartbeatPayload{NodeID: "node-local-01", Timestamp: time.Now().Add(-2 * time.Minute).Unix(), CPUUsage: 12}); err != nil {
			t.Fatal(err)
		}
		node, err := nodes.GetNodeByID(context.Background(), "node-local-01")
		if err != nil {
			t.Fatal(err)
		}
		if node == nil || node.Status != "Not Ready" {
			t.Errorf("mode=%s: stale node must be Not Ready; got %+v", mode, node)
		}
	}
}
