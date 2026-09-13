package service_test

import (
	"context"
	"strings"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/service"
)

type mockSpecRepo struct {
	authorityData     *entity.SpecAuthorityData
	authorityErr      error
	lastReport        *entity.SpecReportCommand
	activeRelease     *entity.ClusterSpecRelease
	publishedReleases []entity.ClusterSpecRelease
}

func (m *mockSpecRepo) GetAuthorityData(ctx context.Context, nodeID string) (*entity.SpecAuthorityData, error) {
	if m.authorityErr != nil {
		return nil, m.authorityErr
	}
	return m.authorityData, nil
}

func (m *mockSpecRepo) RecordReport(ctx context.Context, cmd entity.SpecReportCommand) error {
	m.lastReport = &cmd
	return nil
}

func (m *mockSpecRepo) GetActiveSpecRelease(ctx context.Context) (*entity.ClusterSpecRelease, error) {
	return m.activeRelease, nil
}

func (m *mockSpecRepo) PublishSpecRelease(ctx context.Context, release entity.ClusterSpecRelease) (*entity.ClusterSpecRelease, error) {
	rel := release
	rel.ID = int64(len(m.publishedReleases) + 1)
	m.publishedReleases = append(m.publishedReleases, rel)
	m.activeRelease = &rel
	return &rel, nil
}

func TestSpecSyncService_InSyncAndMismatch(t *testing.T) {
	mockRepo := &mockSpecRepo{
		activeRelease: &entity.ClusterSpecRelease{
			ID:     1,
			Digest: "abcd1234efgh5678",
			SpecJSON: `{
  "version": 1,
  "release_id": 1,
  "routing_conf": "upstream backend { server 127.0.0.1:8080; }\nserver { server_name example.com; }",
  "extensions": [
    {
      "key": "builtin/metrics"
    }
  ]
}`,
		},
	}
	svc := service.NewSpecSyncService(mockRepo)

	// 1. Query with empty/mismatch hash -> returns full JSON and InSync=false
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
	if res1.Hash != "abcd1234efgh5678" {
		t.Fatalf("expected hash 'abcd1234efgh5678', got %q", res1.Hash)
	}
	if res1.SpecJSON == "" {
		t.Fatalf("expected non-empty SpecJSON")
	}
	if res1.ReleaseID != 1 {
		t.Fatalf("expected ReleaseID=1, got %d", res1.ReleaseID)
	}

	// Verify JSON content has authority items
	if !strings.Contains(res1.SpecJSON, "upstream backend") {
		t.Fatalf("expected SpecJSON to contain upstreams config")
	}
	if !strings.Contains(res1.SpecJSON, "example.com") {
		t.Fatalf("expected SpecJSON to contain routing for example.com")
	}
	if !strings.Contains(res1.SpecJSON, "builtin/metrics") {
		t.Fatalf("expected SpecJSON to contain extensions.metrics config")
	}

	// 2. Query with matching hash -> returns InSync=true, SpecJSON="" (0 bytes payload)
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
	if res2.SpecJSON != "" {
		t.Fatalf("expected empty SpecJSON when InSync=true, got %q", res2.SpecJSON)
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

func TestSpecSyncService_EmptyNodeIDAllowed(t *testing.T) {
	mockRepo := &mockSpecRepo{}
	svc := service.NewSpecSyncService(mockRepo)

	res, err := svc.SyncSpec(context.Background(), entity.SpecSyncQuery{
		NodeID: "",
	})
	if err != nil {
		t.Fatalf("unexpected error for empty node_id: %v", err)
	}
	if res == nil {
		t.Fatalf("expected result, got nil")
	}
}
