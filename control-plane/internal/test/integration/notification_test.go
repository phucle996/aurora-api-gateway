package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"github.com/gin-gonic/gin"
)

const notificationTestToken = "test-token-at-least-32-bytes-long-notification"

func notificationFixture(t *testing.T) http.Handler {
	t.Helper()
	path := filepath.Join(t.TempDir(), "notifications.db")
	a, err := app.NewApp(context.Background(), config.Config{
		SQLitePath: path,
		JWTSecret:  notificationTestToken,
	})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()

	pools, err := infra.OpenSQLitePool(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pools.Close() })

	gin.SetMode(gin.TestMode)
	router := gin.New()
	cfg := config.Config{
		SQLitePath: path,
		JWTSecret:  notificationTestToken,
	}
	module := app.NewModule(pools.Writer, pools.Reader, cfg)
	app.RegisterRoutes(router, module, notificationTestToken)
	return router
}

func TestNotificationChannelsAndRulesWorkflow(t *testing.T) {
	handler := notificationFixture(t)

	// 1. GET /api/v1/settings/notifications
	req := httptest.NewRequest(http.MethodGet, "/api/v1/settings/notifications", nil)
	req.Header.Set("Authorization", "Bearer "+notificationTestToken)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var overview entity.NotificationOverview
	if err := json.Unmarshal(w.Body.Bytes(), &overview); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if len(overview.Channels) != 6 {
		t.Fatalf("expected 6 channels, got %d", len(overview.Channels))
	}
	if len(overview.Rules) != 5 {
		t.Fatalf("expected 5 rules, got %d", len(overview.Rules))
	}

	// 2. PUT /api/v1/settings/notifications/channels/telegram
	updatePayload := map[string]interface{}{
		"enabled":     true,
		"config_json": `{"bot_token":"123456:TEST_TOKEN","chat_id":"-10011223344","parse_mode":"HTML"}`,
	}
	bodyBytes, _ := json.Marshal(updatePayload)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/settings/notifications/channels/telegram", bytes.NewReader(bodyBytes))
	req.Header.Set("Authorization", "Bearer "+notificationTestToken)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	// 3. PUT /api/v1/settings/notifications/rules/rule_config_changes
	rulePayload := map[string]interface{}{
		"enabled": true,
	}
	ruleBody, _ := json.Marshal(rulePayload)
	req = httptest.NewRequest(http.MethodPut, "/api/v1/settings/notifications/rules/rule_config_changes", bytes.NewReader(ruleBody))
	req.Header.Set("Authorization", "Bearer "+notificationTestToken)
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	// 4. Verify updated state
	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings/notifications", nil)
	req.Header.Set("Authorization", "Bearer "+notificationTestToken)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	var updated entity.NotificationOverview
	_ = json.Unmarshal(w.Body.Bytes(), &updated)

	var telegramFound bool
	for _, ch := range updated.Channels {
		if ch.ID == "telegram" {
			telegramFound = true
			if !ch.Enabled {
				t.Fatalf("expected telegram channel to be enabled")
			}
		}
	}
	if !telegramFound {
		t.Fatalf("telegram channel not found in overview")
	}

	// 5. Test Channel POST /api/v1/settings/notifications/channels/slack/test
	req = httptest.NewRequest(http.MethodPost, "/api/v1/settings/notifications/channels/slack/test", nil)
	req.Header.Set("Authorization", "Bearer "+notificationTestToken)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for test, got %d: %s", w.Code, w.Body.String())
	}

	var testRes entity.TestNotificationResult
	if err := json.Unmarshal(w.Body.Bytes(), &testRes); err != nil {
		t.Fatalf("failed to unmarshal test result: %v", err)
	}
	if !testRes.Success {
		t.Fatalf("expected test result success, got message: %s", testRes.Message)
	}
}
