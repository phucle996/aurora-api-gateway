package service

import (
	"context"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

type mockDependenciesRepo struct {
	nodes []entity.DependencyNode
}

func (m *mockDependenciesRepo) ListDependencies(ctx context.Context, q entity.ListDependenciesQuery) ([]entity.DependencyNode, error) {
	return m.nodes, nil
}

func (m *mockDependenciesRepo) QueueDependency(ctx context.Context, c entity.QueueDependencyCommand) (entity.QueueDependencyResult, error) {
	return entity.QueueDependencyResult{ID: 10, Action: c.Action, State: "queued"}, nil
}

func (m *mockDependenciesRepo) PollDependency(ctx context.Context, q entity.PollDependencyQuery) (entity.PollDependencyResult, error) {
	return entity.PollDependencyResult{ID: 10, Action: "check"}, nil
}

func (m *mockDependenciesRepo) ReportDependency(ctx context.Context, c entity.ReportDependencyCommand) error {
	return nil
}

func TestDependenciesService_Workflow(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UnixMilli()

	repo := &mockDependenciesRepo{
		nodes: []entity.DependencyNode{
			{
				NodeID:      "node-01",
				CheckedAt:   now - 1000, // fresh
				Installable: true,
			},
			{
				NodeID:      "node-02",
				CheckedAt:   now - 120000, // stale (> 90s)
				Installable: true,
			},
		},
	}

	svc := NewDependenciesService(repo)

	// 1. Test List
	nodes, err := svc.List(ctx, entity.ListDependenciesQuery{})
	if err != nil {
		t.Fatalf("List error: %v", err)
	}
	if len(nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(nodes))
	}
	if !nodes[0].Fresh || !nodes[0].Installable {
		t.Errorf("node-01 should be fresh and installable")
	}
	if nodes[1].Fresh || nodes[1].Installable {
		t.Errorf("node-02 should be stale and not installable")
	}

	// 2. Test Queue valid vs invalid
	_, err = svc.Queue(ctx, entity.QueueDependencyCommand{
		NodeID: "node-01",
		Actor:  "admin",
		Action: "install_brotli",
	})
	if err != nil {
		t.Errorf("Queue valid action error: %v", err)
	}

	_, err = svc.Queue(ctx, entity.QueueDependencyCommand{
		NodeID: "node-01",
		Actor:  "admin",
		Action: "invalid_action",
	})
	if err == nil {
		t.Errorf("Queue invalid action should fail")
	}

	// 3. Test Poll
	pollRes, err := svc.Poll(ctx, entity.PollDependencyQuery{NodeID: "node-01"})
	if err != nil {
		t.Errorf("Poll error: %v", err)
	}
	if pollRes.ID != 10 {
		t.Errorf("Poll ID expected 10, got %d", pollRes.ID)
	}

	// 4. Test Report
	err = svc.Report(ctx, entity.ReportDependencyCommand{
		NodeID:       "node-01",
		CheckedAt:    now,
		NginxVersion: "1.24.0",
		Architecture: "x86_64",
		Modules: []entity.ReportDependencyModule{
			{Name: "ngx_http_brotli_filter_module", Available: true, Loaded: true},
		},
	})
	if err != nil {
		t.Errorf("Report valid error: %v", err)
	}
}
