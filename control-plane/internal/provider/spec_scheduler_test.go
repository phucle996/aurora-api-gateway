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
		NodeID:        nodeID,
		WAFReleaseID:  1,
		WAFPayload:    []byte(`{"rules":[]}`),
		UpstreamsConf: "upstream test { server 127.0.0.1:8080; }\n",

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
				ID:              "prometheus",
				ManifestKey:     "builtin/prometheus",
				ManifestVersion: 1,
				ConfigJSON:      `{"port":9145,"prometheus":{"enabled":true,"path":"/metrics"}}`,
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
	if !strings.Contains(active.SpecJSON, "test.local") {
		t.Fatalf("expected spec JSON to contain test.local")
	}
	if !strings.Contains(active.SpecJSON, "\"key\": \"builtin/prometheus\"") {
		t.Fatalf("expected spec JSON to contain prometheus instance envelope")
	}
	if !strings.Contains(active.SpecJSON, "\"renderer\": \"agent-metrics\"") {
		t.Fatalf("expected spec JSON to contain renderer agent-metrics")
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

	if !strings.Contains(updated.SpecJSON, "updated.local") {
		t.Fatalf("expected updated spec JSON to contain updated.local")
	}
	if !strings.Contains(updated.SpecJSON, "http://new_backend") {
		t.Fatalf("expected spec JSON to contain http://new_backend")
	}
}

func TestSpecScheduler_DeclarativeRoutingJSON(t *testing.T) {
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

	// Verify declarative JSON structure
	if !strings.Contains(rel.SpecJSON, "\"host\": \"secure-service.internal\"") {
		t.Fatalf("expected host in declarative JSON: %s", rel.SpecJSON)
	}
	if !strings.Contains(rel.SpecJSON, "\"upstream\": \"http://backend-upstream\"") {
		t.Fatalf("expected upstream in declarative JSON: %s", rel.SpecJSON)
	}
}

func TestSpecScheduler_CompilesOriginTLS(t *testing.T) {
	mockRepo := &mockSpecSyncRepo{
		authorityData: &entity.SpecAuthorityData{
			RoutingRecords: []entity.SpecRoutingRecord{
				{
					ID:      10,
					Host:    "secure-service.internal",
					Status:  "Active",
					Target:  "secure_backend",
					SSLJSON: `{"enabled":true,"verifyCert":true,"sniHost":"origin.internal","caCert":"CA_PEM","mTLS":true,"clientCert":"CLIENT_CERT","clientKey":"CLIENT_KEY"}`,
				},
			},
		},
	}

	scheduler := provider.NewSpecScheduler(10*time.Second, 0)
	scheduler.Start(context.Background(), mockRepo)
	defer scheduler.Stop()

	mockRepo.mu.Lock()
	active := mockRepo.activeRelease
	mockRepo.mu.Unlock()
	if active == nil {
		t.Fatal("expected a compiled spec release")
	}
	for _, expected := range []string{
		"\"origin_tls\":",
		"\"verify_cert\": true",
		"\"sni_host\": \"origin.internal\"",
		"\"client_key\": \"CLIENT_KEY\"",
	} {
		if !strings.Contains(active.SpecJSON, expected) {
			t.Fatalf("expected compiled spec to contain %q:\n%s", expected, active.SpecJSON)
		}
	}
}

func TestSpecScheduler_PreservesL4UpstreamBackupPeer(t *testing.T) {
	mockRepo := &mockSpecSyncRepo{
		authorityData: &entity.SpecAuthorityData{
			UpstreamRecords: []entity.SpecUnifiedUpstreamRecord{
				{
					Name:        "tcp_failover",
					Algorithm:   "round_robin",
					ServersJSON: `[{"address":"10.10.0.10:9000","weight":1,"maxFails":1,"failTimeout":"5s"},{"address":"10.10.0.11:9000","weight":1,"maxFails":1,"failTimeout":"5s","backup":true}]`,
				},
			},
			L4Services: []entity.SpecL4ServiceRecord{
				{
					Name:              "tcp-edge",
					Protocol:          "tcp",
					ListenPort:        19000,
					ForwardTargetType: "upstream",
					UpstreamName:      "tcp_failover",
					ACLRulesJSON:      `[{"cidr":"0.0.0.0/0","action":"deny","priority":1},{"cidr":"10.10.0.0/16","action":"allow","priority":100}]`,
					Enabled:           true,
				},
			},
		},
	}

	scheduler := provider.NewSpecScheduler(10*time.Second, 0)
	scheduler.Start(context.Background(), mockRepo)
	defer scheduler.Stop()

	mockRepo.mu.Lock()
	active := mockRepo.activeRelease
	mockRepo.mu.Unlock()
	if active == nil {
		t.Fatal("expected L4 authority to publish a spec release")
	}
	if !strings.Contains(active.SpecJSON, "\"addr\": \"10.10.0.11:9000\"") || !strings.Contains(active.SpecJSON, "\"backup\": true") {
		t.Fatalf("expected L4 backup peer in NodeSpec, got:\n%s", active.SpecJSON)
	}
	allowPriority := strings.Index(active.SpecJSON, "\"priority\": 100")
	denyPriority := strings.Index(active.SpecJSON, "\"priority\": 1")
	if allowPriority == -1 || denyPriority == -1 || allowPriority > denyPriority {
		t.Fatalf("expected higher L4 ACL priority to appear first in NodeSpec, got:\n%s", active.SpecJSON)
	}
}

func TestSpecScheduler_CompilesExtensionInstanceEnvelope(t *testing.T) {
	mockRepo := &mockSpecSyncRepo{
		authorityData: &entity.SpecAuthorityData{
			Extensions: []entity.SpecExtensionRecord{
				{
					ID:              "test-cidr-extension",
					ManifestKey:     "builtin/ip-restriction",
					ManifestVersion: 1,
					ConfigJSON: `{
"blacklist":["192.0.2.10/32"],
"rules":[{"id":"office-exception","cidr":"198.51.100.0/24","type":"whitelist","match_value":"/admin","action":"allow","priority":7}]
}`,
				},
			},
		},
	}

	scheduler := provider.NewSpecScheduler(10*time.Second, 0)
	scheduler.Start(context.Background(), mockRepo)
	defer scheduler.Stop()

	mockRepo.mu.Lock()
	active := mockRepo.activeRelease
	mockRepo.mu.Unlock()
	if active == nil {
		t.Fatal("expected an extension instance release")
	}
	for _, expected := range []string{
		"\"instance_id\": \"test-cidr-extension\"",
		"\"key\": \"builtin/ip-restriction\"",
		"\"version\": 1",
		"\"manifest_digest\":",
		"\"config_json\":",
	} {
		if !strings.Contains(active.SpecJSON, expected) {
			t.Fatalf("expected extension instance envelope to contain %q:\n%s", expected, active.SpecJSON)
		}
	}
	if strings.Contains(active.SpecJSON, "\"access\":") {
		t.Fatalf("controller must not compile extension-specific access policy:\n%s", active.SpecJSON)
	}
}
