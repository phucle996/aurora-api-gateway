package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/transport/http/handler"
	"github.com/gin-gonic/gin"
)

type mockAlertmanagerSvc struct {
	overview entity.AlertmanagerOverview
	rules    []entity.PrometheusRuleItem
	firing   []entity.PrometheusActiveAlert
	silences []entity.AlertmanagerSilenceItem
	settings entity.AlertmanagerSettings
}

func (m *mockAlertmanagerSvc) GetOverview(ctx context.Context) (*entity.AlertmanagerOverview, error) {
	return &m.overview, nil
}
func (m *mockAlertmanagerSvc) GetLiveRules(ctx context.Context) ([]entity.PrometheusRuleItem, error) {
	return m.rules, nil
}
func (m *mockAlertmanagerSvc) GetFiringAlerts(ctx context.Context) ([]entity.PrometheusActiveAlert, error) {
	return m.firing, nil
}
func (m *mockAlertmanagerSvc) GetSilences(ctx context.Context) ([]entity.AlertmanagerSilenceItem, error) {
	return m.silences, nil
}
func (m *mockAlertmanagerSvc) CreateSilence(ctx context.Context, s entity.AlertmanagerSilenceItem) (string, error) {
	return "mock-silence-id", nil
}
func (m *mockAlertmanagerSvc) ExpireSilence(ctx context.Context, id string) error {
	return nil
}
func (m *mockAlertmanagerSvc) GetConfig(ctx context.Context) (*entity.AlertmanagerSettings, error) {
	return &m.settings, nil
}
func (m *mockAlertmanagerSvc) UpdateConfig(ctx context.Context, s entity.AlertmanagerSettings) error {
	m.settings = s
	return nil
}

func setupAlertmanagerHandlerRouter(svc *mockAlertmanagerSvc) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewAlertmanagerHandler(svc)

	r.GET("/api/v1/integrations/alerts/overview", h.GetOverview)
	r.GET("/api/v1/integrations/alerts/rules", h.GetLiveRules)
	r.GET("/api/v1/integrations/alerts/firing", h.GetFiringAlerts)
	r.GET("/api/v1/integrations/alerts/silences", h.GetSilences)
	r.POST("/api/v1/integrations/alerts/silences", h.CreateSilence)
	r.DELETE("/api/v1/integrations/alerts/silences/:id", h.ExpireSilence)
	r.GET("/api/v1/integrations/alerts/config", h.GetConfig)
	r.PUT("/api/v1/integrations/alerts/config", h.UpdateConfig)

	return r
}

func TestAlertmanagerHandler_Endpoints(t *testing.T) {
	svc := &mockAlertmanagerSvc{
		overview: entity.AlertmanagerOverview{
			PrometheusConnected:   true,
			AlertmanagerConnected: true,
			TotalRulesCount:       5,
		},
		rules: []entity.PrometheusRuleItem{
			{Name: "Rule1", State: "inactive"},
		},
		silences: []entity.AlertmanagerSilenceItem{
			{ID: "silence-1", Status: "active"},
		},
		settings: entity.AlertmanagerSettings{
			Enabled:         true,
			AlertmanagerURL: "http://127.0.0.1:9093",
			PrometheusURL:   "http://127.0.0.1:9090",
		},
	}

	router := setupAlertmanagerHandlerRouter(svc)

	// 1. GET overview
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v1/integrations/alerts/overview", nil)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// 2. GET rules
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodGet, "/api/v1/integrations/alerts/rules", nil)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	// 3. POST silence
	silenceBody, _ := json.Marshal(map[string]interface{}{
		"ends_at": "2026-09-11T18:00:00Z",
		"comment": "Testing silence endpoint",
		"matchers": []map[string]interface{}{
			{"name": "alertname", "value": "Rule1", "isRegex": false, "isEqual": true},
		},
	})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodPost, "/api/v1/integrations/alerts/silences", bytes.NewReader(silenceBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for create silence, got %d: %s", w.Code, w.Body.String())
	}

	// 4. DELETE silence
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodDelete, "/api/v1/integrations/alerts/silences/silence-1", nil)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for delete silence, got %d", w.Code)
	}

	// 5. PUT config
	enabled := true
	configBody, _ := json.Marshal(map[string]interface{}{
		"enabled":          &enabled,
		"alertmanager_url": "http://localhost:9093",
		"prometheus_url":   "http://localhost:9090",
	})
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodPut, "/api/v1/integrations/alerts/config", bytes.NewReader(configBody))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for update config, got %d: %s", w.Code, w.Body.String())
	}
}
