package service

import (
	"context"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

type mockModuleStoreRepo struct {
	nodes []entity.ModuleStoreNode
	logs  *entity.ModuleJobLogs
}

func (m *mockModuleStoreRepo) ListModules(ctx context.Context, q entity.ListModulesQuery) ([]entity.ModuleStoreNode, error) {
	return m.nodes, nil
}

func (m *mockModuleStoreRepo) QueueJob(ctx context.Context, c entity.QueueModuleJobCommand) (entity.QueueModuleJobResult, error) {
	return entity.QueueModuleJobResult{ID: 10, Action: c.Action, State: "queued"}, nil
}

func (m *mockModuleStoreRepo) PollJob(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error) {
	return entity.PollModuleJobResult{ID: 10, Action: "check"}, nil
}

func (m *mockModuleStoreRepo) ReportModules(ctx context.Context, c entity.ReportModuleCommand) error {
	return nil
}

func (m *mockModuleStoreRepo) GetJobLogs(ctx context.Context, jobID int64) (*entity.ModuleJobLogs, error) {
	return m.logs, nil
}

func TestModuleStoreService_Workflow(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UnixMilli()

	repo := &mockModuleStoreRepo{
		nodes: []entity.ModuleStoreNode{
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
		logs: &entity.ModuleJobLogs{
			ID:      10,
			NodeID:  "node-01",
			Action:  "install_brotli",
			State:   "succeeded",
			Message: "installed successfully",
			Logs:    "checking apt...\ninstalling brotli...\nnginx -t passed\n",
		},
	}

	svc := NewModuleStoreService(repo)

	// 1. Test List
	nodes, err := svc.List(ctx, entity.ListModulesQuery{})
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
	validActions := []string{"check", "install_brotli", "uninstall_brotli", "install_geoip2", "install_nginx_waf"}
	for _, act := range validActions {
		_, err = svc.Queue(ctx, entity.QueueModuleJobCommand{
			NodeID: "node-01",
			Actor:  "admin",
			Action: act,
		})
		if err != nil {
			t.Errorf("Queue valid action %q failed: %v", act, err)
		}
	}

	invalidActions := []string{"invalid_action", "rm -rf /", "shell;curl example.com", "install_", "install"}
	for _, act := range invalidActions {
		_, err = svc.Queue(ctx, entity.QueueModuleJobCommand{
			NodeID: "node-01",
			Actor:  "admin",
			Action: act,
		})
		if err == nil {
			t.Errorf("Queue invalid action %q should have failed", act)
		}
	}

	// 3. Test Poll
	pollRes, err := svc.Poll(ctx, entity.PollModuleJobQuery{NodeID: "node-01"})
	if err != nil {
		t.Errorf("Poll error: %v", err)
	}
	if pollRes.ID != 10 {
		t.Errorf("Poll ID expected 10, got %d", pollRes.ID)
	}

	// 4. Test Report
	err = svc.Report(ctx, entity.ReportModuleCommand{
		NodeID:       "node-01",
		CheckedAt:    now,
		NginxVersion: "1.24.0",
		Architecture: "x86_64",
		Modules: []entity.ReportModuleItem{
			{Name: "ngx_http_brotli_filter_module", Available: true, Loaded: true},
		},
		JobLogs: "success logs",
	})
	if err != nil {
		t.Errorf("Report valid error: %v", err)
	}

	// 5. Test GetJobLogs
	logs, err := svc.GetJobLogs(ctx, entity.ModuleJobLogsQuery{JobID: 10})
	if err != nil {
		t.Errorf("GetJobLogs error: %v", err)
	}
	if logs == nil || logs.ID != 10 || logs.Logs == "" {
		t.Errorf("GetJobLogs returned unexpected data: %+v", logs)
	}

	_, err = svc.GetJobLogs(ctx, entity.ModuleJobLogsQuery{JobID: 0})
	if err == nil {
		t.Errorf("GetJobLogs with ID 0 should fail")
	}
}
