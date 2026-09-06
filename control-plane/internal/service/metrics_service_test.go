package service

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/provider"
)

// Fault injection belongs only to the rollup persistence boundary.
type failingRollupRepository struct {
	repo.NodeRepository
	fail    bool
	written []entity.NodeMetricHistoryRecord
}

func (r *failingRollupRepository) BatchInsertMetricsHistory(ctx context.Context, rows []entity.NodeMetricHistoryRecord) error {
	if _, ok := ctx.Deadline(); !ok {
		return errors.New("missing write deadline")
	}
	if r.fail {
		return errors.New("storage unavailable")
	}
	r.written = append(r.written, rows...)
	return nil
}

type rejectedMetricsConfigRepository struct{ repo.SettingsRepository }

func (r *rejectedMetricsConfigRepository) SaveMetricsConfig(context.Context, entity.MetricsIntegrationConfig) error {
	return errors.New("configuration commit rejected")
}

func TestMetricsFailedTransitionRestartsOldProvider(t *testing.T) {
	for _, failFlush := range []bool{false, true} {
		t.Run(strconv.FormatBool(failFlush), func(t *testing.T) {
			r := &failingRollupRepository{fail: failFlush}
			p := provider.NewStandaloneMetricsProvider(r)
			if err := p.Start(context.Background()); err != nil {
				t.Fatal(err)
			}
			defer func() { r.fail = false; _ = p.Stop() }()
			p.PushMetricPoint("node", entity.NodeMetricPoint{Timestamp: 1, CPUUsage: 20})
			s := &metricsService{repo: &rejectedMetricsConfigRepository{}, activeProvider: p, currentConfig: entity.MetricsIntegrationConfig{Mode: "standalone"}}
			if s.SaveConfig(context.Background(), entity.MetricsIntegrationConfig{Mode: "disabled"}) == nil {
				t.Fatal("failed transition accepted")
			}
			if s.currentConfig.Mode != "standalone" || s.activeProvider != p {
				t.Fatal("uncommitted mode installed")
			}
			running := p.IsRunning()
			retained := p.RollupCount("node")
			if !running || (failFlush && retained != 1) {
				t.Fatal("old provider did not recover", running, retained)
			}
		})
	}
}
