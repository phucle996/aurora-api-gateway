package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"github.com/gin-gonic/gin"
)

func rateLimitsFixture(t *testing.T) (http.Handler, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rate_limits.db")
	a, err := app.NewApp(context.Background(), config.Config{SQLitePath: path})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()

	pools, err := infra.OpenSQLitePool(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { pools.Close() })

	token := "rate-limits-test-token-32-bytes-long"
	router := gin.New()
	module := app.NewModule(pools.Writer, pools.Reader, config.Config{SQLitePath: path})
	app.RegisterRoutes(router, module, token)
	return router, token
}

func TestRateLimitRuleLifecycle(t *testing.T) {
	handler, token := rateLimitsFixture(t)

	// 1. Create a Rate Limit Rule with multi-dimension configuration
	createPayload := map[string]any{
		"name":        "api-login-throttle",
		"description": "Rate limit /api/login endpoint by IP and Header",
		"enabled_dimensions": []string{"ip", "header", "path"},
		"dimension_order":    []string{"ip", "header", "path"},
		"ip_config": map[string]any{
			"source":      "binary_remote_addr",
			"subnet_mask": "/32",
		},
		"header_config": map[string]any{
			"header_name":    "X-API-Key",
			"operator":       "equals",
			"header_value":   "secret-token",
			"case_sensitive": false,
		},
		"path_config": map[string]any{
			"path":       "/api/login",
			"match_type": "prefix",
		},
		"rate_limit":      10,
		"rate_unit":       "1 minute",
		"burst":           20,
		"action_exceeded": "block_429",
		"custom_response": true,
		"response_code":   429,
		"response_body":   `{"error":"rate_limited"}`,
		"log_events":      true,
		"add_reputation":  false,
		"enable_alert":    false,
		"status":          "Active",
	}

	bodyBytes, _ := json.Marshal(createPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/rate-limits", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to parse response JSON: %v", err)
	}

	idVal, ok := created["id"].(float64)
	if !ok || idVal <= 0 {
		t.Fatalf("expected positive rule id, got %v", created["id"])
	}
	ruleID := int64(idVal)

	if created["name"] != "api-login-throttle" {
		t.Errorf("expected name api-login-throttle, got %v", created["name"])
	}

	// 2. List Rate Limit Rules
	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/rate-limits", nil)
	listReq.Header.Set("Authorization", "Bearer "+token)
	listW := httptest.NewRecorder()
	handler.ServeHTTP(listW, listReq)

	if listW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d: %s", listW.Code, listW.Body.String())
	}

	var listResp map[string]any
	if err := json.Unmarshal(listW.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("failed to parse list response JSON: %v", err)
	}

	items, ok := listResp["items"].([]any)
	if !ok || len(items) != 1 {
		t.Fatalf("expected 1 rule in items, got %d", len(items))
	}

	// 3. Get Rule by ID
	getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/rate-limits/%d", ruleID), nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getW := httptest.NewRecorder()
	handler.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK, got %d: %s", getW.Code, getW.Body.String())
	}

	// 4. Duplicate name validation
	dupReq := httptest.NewRequest(http.MethodPost, "/api/v1/rate-limits", bytes.NewReader(bodyBytes))
	dupReq.Header.Set("Content-Type", "application/json")
	dupReq.Header.Set("Authorization", "Bearer "+token)
	dupW := httptest.NewRecorder()
	handler.ServeHTTP(dupW, dupReq)

	if dupW.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400 Bad Request for duplicate name, got %d", dupW.Code)
	}

	// 5. Delete Rule
	delReq := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/rate-limits/%d", ruleID), nil)
	delReq.Header.Set("Authorization", "Bearer "+token)
	delW := httptest.NewRecorder()
	handler.ServeHTTP(delW, delReq)

	if delW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for delete, got %d", delW.Code)
	}
}

func TestRateLimitMetricsWorkflow(t *testing.T) {
	handler, token := rateLimitsFixture(t)

	// 1. Get Stats (empty state)
	statsReq := httptest.NewRequest(http.MethodGet, "/api/v1/rate-limits/stats", nil)
	statsReq.Header.Set("Authorization", "Bearer "+token)
	statsW := httptest.NewRecorder()
	handler.ServeHTTP(statsW, statsReq)

	if statsW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for stats, got %d: %s", statsW.Code, statsW.Body.String())
	}

	var statsResp map[string]any
	if err := json.Unmarshal(statsW.Body.Bytes(), &statsResp); err != nil {
		t.Fatalf("failed to decode stats response: %v", err)
	}
	if _, ok := statsResp["total_hits"]; !ok {
		t.Fatalf("missing total_hits in stats response")
	}

	// 2. Get Metrics (empty state)
	metricsReq := httptest.NewRequest(http.MethodGet, "/api/v1/rate-limits/metrics?range=24h&sort=blocked", nil)
	metricsReq.Header.Set("Authorization", "Bearer "+token)
	metricsW := httptest.NewRecorder()
	handler.ServeHTTP(metricsW, metricsReq)

	if metricsW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for metrics, got %d: %s", metricsW.Code, metricsW.Body.String())
	}

	var metricsResp map[string]any
	if err := json.Unmarshal(metricsW.Body.Bytes(), &metricsResp); err != nil {
		t.Fatalf("failed to decode metrics response: %v", err)
	}
	if _, ok := metricsResp["velocity_series"]; !ok {
		t.Fatalf("missing velocity_series in metrics response")
	}
	if _, ok := metricsResp["top_endpoints"]; !ok {
		t.Fatalf("missing top_endpoints in metrics response")
	}
}
