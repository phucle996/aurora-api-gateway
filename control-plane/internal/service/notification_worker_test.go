package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

type mockNotificationRepo struct {
	ruleEnabled     map[string]bool
	enabledChannels []entity.NotificationChannelItem
}

func (m *mockNotificationRepo) GetOverview(ctx context.Context) (*entity.NotificationOverview, error) {
	return nil, nil
}
func (m *mockNotificationRepo) GetChannelByID(ctx context.Context, id string) (*entity.NotificationChannelItem, error) {
	return nil, nil
}
func (m *mockNotificationRepo) UpdateChannel(ctx context.Context, id string, enabled bool, configJSON string) error {
	return nil
}
func (m *mockNotificationRepo) UpdateRule(ctx context.Context, id string, enabled bool) error {
	return nil
}
func (m *mockNotificationRepo) RecordTestResult(ctx context.Context, id string, status string, message string) error {
	return nil
}
func (m *mockNotificationRepo) GetActiveChannelsCount(ctx context.Context) (int, error) {
	return len(m.enabledChannels), nil
}
func (m *mockNotificationRepo) GetEnabledChannels(ctx context.Context) ([]entity.NotificationChannelItem, error) {
	return m.enabledChannels, nil
}
func (m *mockNotificationRepo) IsRuleEnabled(ctx context.Context, id string) (bool, error) {
	if enabled, ok := m.ruleEnabled[id]; ok {
		return enabled, nil
	}
	return false, nil
}

type mockNotificationProvider struct {
	mu        sync.Mutex
	sentCalls []string // list of channelIDs sent
}

func (p *mockNotificationProvider) Send(ctx context.Context, channelID string, configJSON string, alert entity.AlertEvent) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sentCalls = append(p.sentCalls, channelID)
	return nil
}

func (p *mockNotificationProvider) Test(channelID string, configJSON string) (error, string) {
	return nil, "ok"
}

func (p *mockNotificationProvider) getCalls() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	res := make([]string, len(p.sentCalls))
	copy(res, p.sentCalls)
	return res
}

func TestNotificationWorker_EnqueueAndSaturation(t *testing.T) {
	repo := &mockNotificationRepo{}
	prov := &mockNotificationProvider{}

	// Small queue of size 2
	worker := NewNotificationWorker(repo, prov, 2)

	e1 := entity.AlertEvent{Title: "Alert 1"}
	e2 := entity.AlertEvent{Title: "Alert 2"}
	e3 := entity.AlertEvent{Title: "Alert 3"}

	if !worker.Enqueue(e1) {
		t.Fatalf("worker.Enqueue(e1) should succeed")
	}
	if !worker.Enqueue(e2) {
		t.Fatalf("worker.Enqueue(e2) should succeed")
	}
	// Queue is now full (cap=2) -> should return false immediately without blocking
	if worker.Enqueue(e3) {
		t.Fatalf("worker.Enqueue(e3) should return false on full queue")
	}
}

func TestNotificationWorker_DispatchAlertFlow(t *testing.T) {
	repo := &mockNotificationRepo{
		ruleEnabled: map[string]bool{
			"rule_critical": true,
			"rule_disabled": false,
		},
		enabledChannels: []entity.NotificationChannelItem{
			{ID: "slack", Enabled: true, ConfigJSON: "{}"},
			{ID: "telegram", Enabled: true, ConfigJSON: "{}"},
		},
	}
	prov := &mockNotificationProvider{}

	worker := NewNotificationWorker(repo, prov, 10)
	ctx := context.Background()
	worker.Start(ctx)

	// 1. Send an alert for an enabled rule
	worker.Enqueue(entity.AlertEvent{
		RuleID:   "rule_critical",
		Title:    "Critical Threat",
		Severity: "critical",
	})

	// 2. Send an alert for a disabled rule
	worker.Enqueue(entity.AlertEvent{
		RuleID:   "rule_disabled",
		Title:    "Ignored Threat",
		Severity: "low",
	})

	// Wait briefly for worker to process queue
	time.Sleep(100 * time.Millisecond)
	worker.Stop()

	calls := prov.getCalls()
	// Should dispatch to 2 channels for "rule_critical", and 0 for "rule_disabled"
	if len(calls) != 2 {
		t.Fatalf("expected 2 channel calls, got %d: %v", len(calls), calls)
	}
	if calls[0] != "slack" || calls[1] != "telegram" {
		t.Fatalf("expected [slack, telegram], got %v", calls)
	}
}
