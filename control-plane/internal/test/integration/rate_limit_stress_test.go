package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestRateLimit_UpdateRuleLifecycle kiểm tra độc lập workflow Sửa (Update) Rule Rate Limit.
func TestRateLimit_UpdateRuleLifecycle(t *testing.T) {
	handler, token := rateLimitsFixture(t)

	// 1. Tạo một rule ban đầu
	createPayload := map[string]any{
		"name":               "rule-to-update",
		"description":        "Rule ban đầu",
		"enabled_dimensions": []string{"ip"},
		"dimension_order":    []string{"ip"},
		"ip_config": map[string]any{
			"source":      "binary_remote_addr",
			"subnet_mask": "/32",
		},
		"header_config": map[string]any{
			"header_name": "", "operator": "equals", "header_value": "", "case_sensitive": false,
		},
		"path_config": map[string]any{
			"path": "/", "match_type": "prefix",
		},
		"rate_limit":      100,
		"rate_unit":       "1 minute",
		"burst":           50,
		"action_exceeded": "block_429",
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

	var createdResp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &createdResp)
	ruleID := int64(createdResp["id"].(float64))

	// 2. Cập nhật (Update / Sửa) rule vừa tạo
	updatePayload := map[string]any{
		"name":               "rule-updated-name",
		"description":        "Mô tả đã được sửa",
		"enabled_dimensions": []string{"ip", "header"},
		"dimension_order":    []string{"ip", "header"},
		"ip_config": map[string]any{
			"source":      "binary_remote_addr",
			"subnet_mask": "/24",
		},
		"header_config": map[string]any{
			"header_name":    "X-VIP",
			"operator":       "equals",
			"header_value":   "true",
			"case_sensitive": false,
		},
		"path_config": map[string]any{
			"path": "/api", "match_type": "prefix",
		},
		"rate_limit":      500,
		"rate_unit":       "1 second",
		"burst":           200,
		"action_exceeded": "challenge_js",
		"status":          "Inactive",
	}
	updateBytes, _ := json.Marshal(updatePayload)
	putReq := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/v1/rate-limits/%d", ruleID), bytes.NewReader(updateBytes))
	putReq.Header.Set("Content-Type", "application/json")
	putReq.Header.Set("Authorization", "Bearer "+token)
	putW := httptest.NewRecorder()
	handler.ServeHTTP(putW, putReq)

	if putW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for update, got %d: %s", putW.Code, putW.Body.String())
	}

	// 3. Đọc lại để xác thực dữ liệu đã lưu chính xác
	getReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/rate-limits/%d", ruleID), nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getW := httptest.NewRecorder()
	handler.ServeHTTP(getW, getReq)

	if getW.Code != http.StatusOK {
		t.Fatalf("expected status 200 OK for get, got %d", getW.Code)
	}

	var getResp map[string]any
	_ = json.Unmarshal(getW.Body.Bytes(), &getResp)
	if getResp["name"] != "rule-updated-name" {
		t.Fatalf("expected name 'rule-updated-name', got %v", getResp["name"])
	}
	if getResp["rate_limit"].(float64) != 500 {
		t.Fatalf("expected rate_limit 500, got %v", getResp["rate_limit"])
	}
	if getResp["status"] != "Inactive" {
		t.Fatalf("expected status 'Inactive', got %v", getResp["status"])
	}
}

// TestRateLimit_20MillionRequestsStressAndCRUDUnderLoad is deprecated since RateLimitCollector was removed.
func TestRateLimit_20MillionRequestsStressAndCRUDUnderLoad(t *testing.T) {
	t.Skip("deprecated: RateLimitCollector in-memory buffering has been removed; telemetry is query-only via TSDB")
}
