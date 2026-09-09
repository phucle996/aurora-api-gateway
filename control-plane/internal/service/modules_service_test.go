package service

import (
	"context"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/provider"
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

func (m *mockModuleStoreRepo) AppendJobLog(ctx context.Context, c entity.AppendModuleJobLogCommand) error {
	if m.logs != nil && m.logs.ID == c.JobID {
		m.logs.Logs += c.LogChunk
	}
	return nil
}

func (m *mockModuleStoreRepo) GetSyncOverview(ctx context.Context, q entity.GetModuleSyncOverviewQuery) ([]entity.ModuleSyncItem, error) {
	return []entity.ModuleSyncItem{
		{
			Name:         "brotli",
			Desired:      true,
			ActualLoaded: 1,
			TotalNodes:   1,
			SyncStatus:   "Synced",
			FeatureReady: true,
		},
	}, nil
}

func (m *mockModuleStoreRepo) SetDesiredState(ctx context.Context, c entity.SetModuleDesiredCommand) error {
	return nil
}

func (m *mockModuleStoreRepo) FanoutSync(ctx context.Context, c entity.TriggerModuleSyncCommand) (entity.TriggerModuleSyncResult, error) {
	return entity.TriggerModuleSyncResult{QueuedJobs: 1, NodeIDs: []string{"node-01"}}, nil
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

	eventHub := provider.NewEventHub()
	svc := NewModuleStoreService(repo, eventHub)

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

	// 6. Test AppendJobLog and SubscribeJobEvents via provider.EventHub
	ch, unsub := svc.SubscribeJobEvents()
	defer unsub()

	err = svc.AppendJobLog(ctx, entity.AppendModuleJobLogCommand{
		NodeID:   "node-01",
		JobID:    10,
		Stage:    "CANARY_PROBE",
		Progress: 60,
		Message:  "Probing canary port...",
		LogChunk: "Canary probe passed\n",
	})
	if err != nil {
		t.Errorf("AppendJobLog error: %v", err)
	}

	select {
	case msg := <-ch:
		if msg.Event != "module_job_progress" {
			t.Errorf("Expected event 'module_job_progress', got %q", msg.Event)
		}
		ev, ok := msg.Data.(entity.ModuleJobProgressEvent)
		if !ok || ev.JobID != 10 || ev.Stage != "CANARY_PROBE" || ev.Progress != 60 {
			t.Errorf("Received unexpected event data: %+v", msg.Data)
		}
	case <-time.After(500 * time.Millisecond):
		t.Errorf("Timed out waiting for SSE job event from EventHub")
	}

	// 7. Test Sync Overview & Desired State methods
	overview, err := svc.GetSyncOverview(ctx, entity.GetModuleSyncOverviewQuery{})
	if err != nil || len(overview) == 0 {
		t.Fatalf("GetSyncOverview failed: %v", err)
	}
	if overview[0].Name != "brotli" || !overview[0].Desired || !overview[0].FeatureReady {
		t.Errorf("Unexpected sync overview item: %+v", overview[0])
	}

	err = svc.SetDesiredState(ctx, entity.SetModuleDesiredCommand{
		Name:    "brotli",
		Enabled: true,
		Actor:   "admin",
	})
	if err != nil {
		t.Errorf("SetDesiredState failed: %v", err)
	}

	syncRes, err := svc.Sync(ctx, entity.TriggerModuleSyncCommand{
		Name:  "brotli",
		Actor: "admin",
	})
	if err != nil || syncRes.QueuedJobs != 1 {
		t.Errorf("Sync failed: %v, result: %+v", err, syncRes)
	}
}
