package service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/service"
)

type mockAlertmanagerRepo struct {
	settings entity.AlertmanagerSettings
}

func (m *mockAlertmanagerRepo) GetSettings(ctx context.Context) (*entity.AlertmanagerSettings, error) {
	return &m.settings, nil
}

func (m *mockAlertmanagerRepo) UpdateSettings(ctx context.Context, s entity.AlertmanagerSettings) error {
	m.settings = s
	return nil
}

func TestAlertmanagerService_FullLifecycle(t *testing.T) {
	// 1. Mock Prometheus server
	promServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/-/ready":
			w.WriteHeader(http.StatusOK)
		case "/api/v1/rules":
			resp := map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"groups": []map[string]interface{}{
						{
							"name": "aurora-waf-alerts",
							"rules": []map[string]interface{}{
								{
									"state":    "firing",
									"name":     "AuroraHighWafBlockRate",
									"query":    "sum(rate(aurora_waf_evaluations_total{action=\"block\"}[2m])) > 50",
									"duration": 60,
									"health":   "ok",
									"labels": map[string]string{
										"severity": "critical",
									},
									"annotations": map[string]string{
										"summary": "Tỷ lệ block WAF cao đột biến",
									},
									"alerts": []map[string]interface{}{
										{
											"state":    "firing",
											"activeAt": "2026-09-11T12:00:00Z",
											"value":    "120",
											"labels": map[string]string{
												"node_id": "node-01",
											},
											"annotations": map[string]string{
												"summary": "Tỷ lệ block WAF cao đột biến trên node-01",
											},
										},
									},
								},
								{
									"state":    "inactive",
									"name":     "AuroraNodeHighCpu",
									"query":    "aurora_node_cpu_percent > 85",
									"duration": 180,
									"health":   "ok",
									"labels": map[string]string{
										"severity": "high",
									},
									"annotations": map[string]string{
										"summary": "CPU cao",
									},
								},
							},
						},
					},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(resp)
		default:
			http.NotFound(w, r)
		}
	}))
	defer promServer.Close()

	// 2. Mock Alertmanager server
	amServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/-/ready":
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/api/v2/silences" && r.Method == http.MethodGet:
			resp := []map[string]interface{}{
				{
					"id": "silence-123",
					"status": map[string]string{
						"state": "active",
					},
					"startsAt":  "2026-09-11T12:00:00Z",
					"endsAt":    "2026-09-11T14:00:00Z",
					"createdBy": "admin",
					"comment":   "Bảo trì định kỳ",
					"matchers": []map[string]interface{}{
						{
							"name":    "alertname",
							"value":   "AuroraNodeHighCpu",
							"isRegex": false,
							"isEqual": true,
						},
					},
				},
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(resp)
		case r.URL.Path == "/api/v2/silences" && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]string{"silenceID": "silence-456"})
		case r.URL.Path == "/api/v2/silence/silence-123" && r.Method == http.MethodDelete:
			w.WriteHeader(http.StatusOK)
		default:
			http.NotFound(w, r)
		}
	}))
	defer amServer.Close()

	repo := &mockAlertmanagerRepo{
		settings: entity.AlertmanagerSettings{
			Enabled:         true,
			PrometheusURL:   promServer.URL,
			AlertmanagerURL: amServer.URL,
		},
	}

	svc := service.NewAlertmanagerService(repo)
	ctx := context.Background()

	// 1. Kiểm tra Overview
	overview, err := svc.GetOverview(ctx)
	if err != nil {
		t.Fatalf("GetOverview failed: %v", err)
	}
	if !overview.PrometheusConnected || !overview.AlertmanagerConnected {
		t.Errorf("expected both services connected, got prom=%v, am=%v",
			overview.PrometheusConnected, overview.AlertmanagerConnected)
	}
	if overview.TotalRulesCount != 2 {
		t.Errorf("expected 2 rules, got %d", overview.TotalRulesCount)
	}
	if overview.ActiveAlertsCount != 1 {
		t.Errorf("expected 1 active alert, got %d", overview.ActiveAlertsCount)
	}
	if overview.ActiveSilencesCount != 1 {
		t.Errorf("expected 1 active silence, got %d", overview.ActiveSilencesCount)
	}

	// 2. Kiểm tra GetLiveRules
	rules, err := svc.GetLiveRules(ctx)
	if err != nil {
		t.Fatalf("GetLiveRules failed: %v", err)
	}
	if len(rules) != 2 {
		t.Fatalf("expected 2 rules, got %d", len(rules))
	}
	if rules[0].State != "firing" || rules[1].State != "inactive" {
		t.Errorf("unexpected rule states: %s, %s", rules[0].State, rules[1].State)
	}

	// 3. Kiểm tra GetFiringAlerts
	firing, err := svc.GetFiringAlerts(ctx)
	if err != nil {
		t.Fatalf("GetFiringAlerts failed: %v", err)
	}
	if len(firing) != 1 {
		t.Fatalf("expected 1 firing alert, got %d", len(firing))
	}

	// 4. Kiểm tra CreateSilence
	newSil := entity.AlertmanagerSilenceItem{
		EndsAt:    "2026-09-11T16:00:00Z",
		CreatedBy: "admin",
		Comment:   "Test silence",
		Matchers: []entity.AlertmanagerMatcher{
			{Name: "alertname", Value: "AuroraHighWafBlockRate", IsRegex: false, IsEqual: true},
		},
	}
	silID, err := svc.CreateSilence(ctx, newSil)
	if err != nil {
		t.Fatalf("CreateSilence failed: %v", err)
	}
	if silID != "silence-456" {
		t.Errorf("expected silence-456, got %s", silID)
	}

	// 5. Kiểm tra ExpireSilence
	if err := svc.ExpireSilence(ctx, "silence-123"); err != nil {
		t.Fatalf("ExpireSilence failed: %v", err)
	}
}
