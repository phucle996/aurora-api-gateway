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
	repo.AnalyticsRepository
	committed chan struct{}
	resume    chan struct{}
}

func (g *metricsAuditSaveGate) SaveMetricsConfig(ctx context.Context, c entity.MetricsIntegrationConfig) error {
	if err := g.AnalyticsRepository.SaveMetricsConfig(ctx, c); err != nil {
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
	durable := repository.NewAnalyticsRepository(pools.Writer)
	gate := &metricsAuditSaveGate{AnalyticsRepository: durable, committed: make(chan struct{}), resume: make(chan struct{})}
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
	_, runtimeErr := s.Query(context.Background(), entity.AnalyticsQueryRequest{SourceID: "prometheus"})
	if cfg.Mode != "disabled" || !errors.Is(runtimeErr, taxonomy.ErrMetricsDisabled) {
		t.Errorf("durable mode=%s but runtime error=%v; later SQLite commit must win both durable and active state", cfg.Mode, runtimeErr)
	}
}

func TestAuditStandaloneRollupSurvivesRequestCancellation(t *testing.T) {
	t.Skip("deprecated: standalone mode rollup worker has been removed in favor of external TSDB query engine")
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
	metrics := service.NewMetricsService(repository.NewAnalyticsRepository(pools.Writer), nodeRepo)
	nodes := service.NewNodeService(nodeRepo, metrics, nil)
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
