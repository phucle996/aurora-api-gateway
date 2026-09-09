package service_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/service"
)

type mockSpecRepo struct {
	authorityData *entity.SpecAuthorityData
	authorityErr  error
	lastReport    *entity.SpecReportCommand
}

func (m *mockSpecRepo) GetAuthorityData(ctx context.Context, nodeID string) (*entity.SpecAuthorityData, error) {
	if m.authorityErr != nil {
		return nil, m.authorityErr
	}
	if m.authorityData != nil {
		return m.authorityData, nil
	}
	return &entity.SpecAuthorityData{
		NodeID:          nodeID,
		WAFReleaseID:    101,
		WAFPayload:      []byte(`{"rules":[{"id":1,"action":"block"}]}`),
		AccessReleaseID: 102,
		AccessPayload:   []byte(`{"ip_rules":[]}`),
		UpstreamsConf:   "upstream backend { server 127.0.0.1:8080; }\n",
		RoutingRecords: []entity.SpecRoutingRecord{
			{
				ID:        1,
				Host:      "example.com",
				Status:    "Active",
				Target:    "http://backend",
				Algorithm: "round_robin",
			},
		},
		Extensions: []entity.SpecExtensionRecord{
			{
				ID:         "metrics",
				Name:       "Prometheus & OTLP Telemetry",
				Category:   "observability",
				Enabled:    true,
				ConfigJSON: `{"port":9145,"stub_status_url":"http://127.0.0.1:80/stub_status","prometheus":{"enabled":true,"path":"/metrics"}}`,
			},
		},
	}, nil
}

func (m *mockSpecRepo) RecordReport(ctx context.Context, cmd entity.SpecReportCommand) error {
	m.lastReport = &cmd
	return nil
}

func TestSpecSyncService_InSyncAndMismatch(t *testing.T) {
	mockRepo := &mockSpecRepo{}
	svc := service.NewSpecSyncService(mockRepo)

	// 1. Initial query with empty hash -> returns full YAML and InSync=false
	res1, err := svc.SyncSpec(context.Background(), entity.SpecSyncQuery{
		NodeID:      "node-01",
		CurrentHash: "",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res1.InSync {
		t.Fatalf("expected InSync=false on first query")
	}
	if res1.Hash == "" {
		t.Fatalf("expected non-empty hash")
	}
	if res1.SpecYAML == "" {
		t.Fatalf("expected non-empty SpecYAML")
	}
	if res1.ReleaseID != 101 {
		t.Fatalf("expected ReleaseID=101, got %d", res1.ReleaseID)
	}

	// Verify YAML content has authority items
	if !strings.Contains(res1.SpecYAML, "upstream backend") {
		t.Fatalf("expected SpecYAML to contain upstreams config")
	}
	if !strings.Contains(res1.SpecYAML, "example.com") {
		t.Fatalf("expected SpecYAML to contain routing for example.com")
	}
	if !strings.Contains(res1.SpecYAML, "metrics:") {
		t.Fatalf("expected SpecYAML to contain extensions.metrics config")
	}

	// 2. Query with matching hash -> returns InSync=true, SpecYAML="" (0 bytes payload)
	res2, err := svc.SyncSpec(context.Background(), entity.SpecSyncQuery{
		NodeID:      "node-01",
		CurrentHash: res1.Hash,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !res2.InSync {
		t.Fatalf("expected InSync=true when hash matches")
	}
	if res2.SpecYAML != "" {
		t.Fatalf("expected empty SpecYAML when InSync=true, got %q", res2.SpecYAML)
	}
	if res2.Hash != res1.Hash {
		t.Fatalf("expected matching hash, got %s vs %s", res2.Hash, res1.Hash)
	}

	// 3. ReportSpec forwards to repo
	reportCmd := entity.SpecReportCommand{
		NodeID:    "node-01",
		ReleaseID: res1.ReleaseID,
		Hash:      res1.Hash,
		Status:    "in_sync",
		Message:   "Applied spec cleanly",
	}
	if err := svc.ReportSpec(context.Background(), reportCmd); err != nil {
		t.Fatalf("unexpected error on ReportSpec: %v", err)
	}
	if mockRepo.lastReport == nil || mockRepo.lastReport.Status != "in_sync" {
		t.Fatalf("expected report recorded in repo")
	}
}

func TestSpecSyncService_UnregisteredNode(t *testing.T) {
	mockRepo := &mockSpecRepo{
		authorityErr: fmt.Errorf("unregistered node: unknown-node"),
	}
	svc := service.NewSpecSyncService(mockRepo)

	_, err := svc.SyncSpec(context.Background(), entity.SpecSyncQuery{
		NodeID: "unknown-node",
	})
	if err == nil {
		t.Fatalf("expected error for unregistered node")
	}
}
