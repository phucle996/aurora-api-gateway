package provider_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/provider"
)

type mockSpecSyncRepo struct {
	mu                sync.Mutex
	authorityData     *entity.SpecAuthorityData
	activeRelease     *entity.ClusterSpecRelease
	publishedReleases []entity.ClusterSpecRelease
	lastReport        *entity.SpecReportCommand
}

func (m *mockSpecSyncRepo) GetAuthorityData(ctx context.Context, nodeID string) (*entity.SpecAuthorityData, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.authorityData != nil {
		return m.authorityData, nil
	}
	return &entity.SpecAuthorityData{
		NodeID:          nodeID,
		WAFReleaseID:    1,
		WAFPayload:      []byte(`{"rules":[]}`),
		AccessReleaseID: 1,
		AccessPayload:   []byte(`{"ip_rules":[]}`),
		UpstreamsConf:   "upstream test { server 127.0.0.1:8080; }\n",
		RoutingRecords: []entity.SpecRoutingRecord{
			{
				ID:        1,
				Host:      "test.local",
				Status:    "Active",
				Target:    "http://test",
				Algorithm: "round_robin",
			},
		},
		Extensions: []entity.SpecExtensionRecord{
			{
				ID:         "prometheus",
				Name:       "Prometheus",
				Category:   "observability",
				Enabled:    true,
				ConfigJSON: `{"port":9145}`,
			},
		},
	}, nil
}

func (m *mockSpecSyncRepo) GetActiveSpecRelease(ctx context.Context) (*entity.ClusterSpecRelease, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.activeRelease, nil
}

func (m *mockSpecSyncRepo) PublishSpecRelease(ctx context.Context, release entity.ClusterSpecRelease) (*entity.ClusterSpecRelease, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rel := release
	rel.ID = int64(len(m.publishedReleases) + 1)
	m.publishedReleases = append(m.publishedReleases, rel)
	m.activeRelease = &rel
	return &rel, nil
}

func (m *mockSpecSyncRepo) RecordReport(ctx context.Context, cmd entity.SpecReportCommand) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.lastReport = &cmd
	return nil
}

func TestSpecScheduler_WarmupAndReconcile(t *testing.T) {
	mockRepo := &mockSpecSyncRepo{}
	scheduler := provider.NewSpecScheduler(100*time.Millisecond, 0.10)

	// Start binds repo and synchronously executes warm-up Reconcile
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	scheduler.Start(ctx, mockRepo)
	defer scheduler.Stop()

	// Verify activeRelease is immediately populated by warm-up
	mockRepo.mu.Lock()
	active := mockRepo.activeRelease
	publishedCount := len(mockRepo.publishedReleases)
	mockRepo.mu.Unlock()

	if active == nil {
		t.Fatalf("expected activeRelease to be populated on Start warm-up")
	}
	if publishedCount != 1 {
		t.Fatalf("expected exactly 1 published release, got %d", publishedCount)
	}
	if !strings.Contains(active.SpecYAML, "test.local") {
		t.Fatalf("expected spec YAML to contain test.local")
	}
	if !strings.Contains(active.SpecYAML, "prometheus:") {
		t.Fatalf("expected spec YAML to contain prometheus")
	}

	// Calling Reconcile with unchanged authority should NOT publish a duplicate release
	rel, err := scheduler.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected reconcile error: %v", err)
	}
	if rel.ID != active.ID {
		t.Fatalf("expected same release ID %d, got %d", active.ID, rel.ID)
	}

	mockRepo.mu.Lock()
	if len(mockRepo.publishedReleases) != 1 {
		t.Fatalf("expected no new release published when content digest unchanged")
	}
	mockRepo.mu.Unlock()

	// Modify authority data and trigger reconcile
	mockRepo.mu.Lock()
	mockRepo.authorityData = &entity.SpecAuthorityData{
		UpstreamsConf: "upstream new_backend { server 10.0.0.1:8080; }\n",
		RoutingRecords: []entity.SpecRoutingRecord{
			{
				ID:        2,
				Host:      "updated.local",
				Status:    "Active",
				Target:    "http://new_backend",
				Algorithm: "round_robin",
			},
		},
	}
	mockRepo.mu.Unlock()

	scheduler.TriggerReconcile()

	// Wait briefly for triggerCh to be processed
	var updated *entity.ClusterSpecRelease
	for i := 0; i < 20; i++ {
		time.Sleep(20 * time.Millisecond)
		mockRepo.mu.Lock()
		if len(mockRepo.publishedReleases) > 1 {
			updated = mockRepo.activeRelease
			mockRepo.mu.Unlock()
			break
		}
		mockRepo.mu.Unlock()
	}

	if !strings.Contains(updated.SpecYAML, "updated.local") {
		t.Fatalf("expected updated spec YAML to contain updated.local")
	}
	if !strings.Contains(updated.SpecYAML, "http://new_backend") {
		t.Fatalf("expected spec YAML to contain http://new_backend")
	}
}

func TestSpecScheduler_DeclarativeRoutingYAML(t *testing.T) {
	mockRepo := &mockSpecSyncRepo{
		authorityData: &entity.SpecAuthorityData{
			RoutingRecords: []entity.SpecRoutingRecord{
				{
					ID:     10,
					Host:   "secure-service.internal",
					Status: "Active",
					Target: "http://backend-upstream",
				},
			},
		},
	}

	scheduler := provider.NewSpecScheduler(10*time.Second, 0)
	ctx := context.Background()
	scheduler.Start(ctx, mockRepo)
	defer scheduler.Stop()

	rel, err := scheduler.Reconcile(ctx)
	if err != nil {
		t.Fatalf("unexpected reconcile error: %v", err)
	}

	// Verify declarative YAML structure
	if !strings.Contains(rel.SpecYAML, "host: secure-service.internal") {
		t.Fatalf("expected host in declarative YAML: %s", rel.SpecYAML)
	}
	if !strings.Contains(rel.SpecYAML, "upstream: http://backend-upstream") {
		t.Fatalf("expected upstream in declarative YAML: %s", rel.SpecYAML)
	}
}
