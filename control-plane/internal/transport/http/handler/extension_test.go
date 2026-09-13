package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/transport/http/handler"
	"github.com/gin-gonic/gin"
)

type mockExtService struct {
	listFn         func(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error)
	getByIDFn      func(ctx context.Context, id string) (*entity.ExtensionRecord, error)
	updateStatusFn func(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error
	updateConfigFn func(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error
}

func (m *mockExtService) ListExtensions(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
	if m.listFn != nil {
		return m.listFn(ctx, q)
	}
	return []entity.ExtensionRecord{}, nil
}

func (m *mockExtService) GetExtension(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
	if m.getByIDFn != nil {
		return m.getByIDFn(ctx, id)
	}
	return nil, fmt.Errorf("extension not found: %s", id)
}

func (m *mockExtService) UpdateExtensionStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
	if m.updateStatusFn != nil {
		return m.updateStatusFn(ctx, cmd)
	}
	return nil
}

func (m *mockExtService) UpdateExtensionConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
	if m.updateConfigFn != nil {
		return m.updateConfigFn(ctx, cmd)
	}
	return nil
}

func setupTestRouter(svc *mockExtService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	h := handler.NewExtensionHandler(svc)

	r.GET("/api/v1/extensions", h.List)
	r.GET("/api/v1/extensions/:id", h.GetByID)
	r.PUT("/api/v1/extensions/:id/status", h.UpdateStatus)
	r.PUT("/api/v1/extensions/:id/config", h.UpdateConfig)

	return r
}

func TestExtensionHandler_List(t *testing.T) {
	svc := &mockExtService{
		listFn: func(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
			return []entity.ExtensionRecord{
				{
					ID:              "metrics",
					ManifestKey:     "builtin/prometheus",
					ManifestVersion: 1,
					Name:            "Prometheus",
					Category:        "observability",
					Enabled:         true,
				},
			}, nil
		},
	}

	r := setupTestRouter(svc)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/extensions?category=observability", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["total"].(float64) != 1 {
		t.Errorf("expected total=1, got %v", resp["total"])
	}
}

func TestExtensionHandler_GetByID(t *testing.T) {
	svc := &mockExtService{
		getByIDFn: func(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
			if id == "metrics" {
				return &entity.ExtensionRecord{
					ID:              "metrics",
					ManifestKey:     "builtin/prometheus",
					ManifestVersion: 1,
					Name:            "Prometheus",
					Category:        "observability",
				}, nil
			}
			return nil, fmt.Errorf("extension not found: %s", id)
		},
	}

	r := setupTestRouter(svc)

	// Found
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/extensions/metrics", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	// Not Found
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("GET", "/api/v1/extensions/unknown", nil)
	r.ServeHTTP(w2, req2)
	if w2.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w2.Code)
	}
}

func TestExtensionHandler_UpdateStatus(t *testing.T) {
	var capturedCmd entity.UpdateExtensionStatusCommand
	svc := &mockExtService{
		updateStatusFn: func(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
			capturedCmd = cmd
			return nil
		},
	}

	r := setupTestRouter(svc)
	body := bytes.NewBufferString(`{"enabled": true}`)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/v1/extensions/metrics/status", body)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if capturedCmd.ID != "metrics" || !capturedCmd.Enabled {
		t.Errorf("unexpected command: %+v", capturedCmd)
	}
}

func TestExtensionHandler_UpdateConfig(t *testing.T) {
	var capturedCmd entity.UpdateExtensionConfigCommand
	svc := &mockExtService{
		updateConfigFn: func(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
			capturedCmd = cmd
			return nil
		},
	}

	r := setupTestRouter(svc)

	// 1. Using arbitrary config object
	body := bytes.NewBufferString(`{"config": {"port": 8080, "timeout": 30}}`)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/v1/extensions/metrics/config", body)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if capturedCmd.ID != "metrics" || capturedCmd.ConfigJSON == "" {
		t.Errorf("unexpected command: %+v", capturedCmd)
	}

	// 2. Using config_json string
	body2 := bytes.NewBufferString(`{"config_json": "{\"rate\": 100}"}`)
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest("PUT", "/api/v1/extensions/rate_limiter/config", body2)
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
	if capturedCmd.ID != "rate_limiter" || capturedCmd.ConfigJSON != `{"rate": 100}` {
		t.Errorf("unexpected command: %+v", capturedCmd)
	}
}

func TestExtensionHandler_TransportValidation_EmptyID(t *testing.T) {
	svc := &mockExtService{}
	r := setupTestRouter(svc)

	// GetByID empty / whitespace ID
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("GET", "/api/v1/extensions/%20", nil)
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty id, got %d", w.Code)
	}

	// UpdateStatus empty / whitespace ID
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/v1/extensions/%20/status", bytes.NewBufferString(`{"enabled":true}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty id on status, got %d", w.Code)
	}

	// UpdateConfig empty / whitespace ID
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/v1/extensions/%20/config", bytes.NewBufferString(`{"config_json":"{}"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for empty id on config, got %d", w.Code)
	}
}

func TestExtensionHandler_TransportValidation_ContentType(t *testing.T) {
	svc := &mockExtService{}
	r := setupTestRouter(svc)

	// Unsupported media type for status
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/v1/extensions/metrics/status", bytes.NewBufferString(`{"enabled":true}`))
	req.Header.Set("Content-Type", "text/plain")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("expected 415 for text/plain, got %d", w.Code)
	}

	// Unsupported media type for config
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/v1/extensions/metrics/config", bytes.NewBufferString(`{"config_json":"{}"}`))
	req.Header.Set("Content-Type", "text/plain")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnsupportedMediaType {
		t.Errorf("expected 415 for text/plain, got %d", w.Code)
	}
}

func TestExtensionHandler_TransportValidation_UnknownFieldsAndTrailing(t *testing.T) {
	svc := &mockExtService{}
	r := setupTestRouter(svc)

	// Unknown field in status payload
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/v1/extensions/metrics/status", bytes.NewBufferString(`{"enabled":true,"unknown_param":123}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for unknown fields in status, got %d", w.Code)
	}

	// Trailing JSON in status payload
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/v1/extensions/metrics/status", bytes.NewBufferString(`{"enabled":true} {"extra":true}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for trailing JSON in status, got %d", w.Code)
	}

	// Unknown field in config payload
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/v1/extensions/metrics/config", bytes.NewBufferString(`{"config_json":"{}","unknown_param":123}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for unknown fields in config, got %d", w.Code)
	}

	// Trailing JSON in config payload
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/v1/extensions/metrics/config", bytes.NewBufferString(`{"config_json":"{}"} {"extra":true}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for trailing JSON in config, got %d", w.Code)
	}
}

func TestExtensionHandler_TransportValidation_InvalidJSONConfig(t *testing.T) {
	svc := &mockExtService{}
	r := setupTestRouter(svc)

	// config_json with malformed JSON string
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/v1/extensions/metrics/config", bytes.NewBufferString(`{"config_json":"{malformed json"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for malformed config_json, got %d", w.Code)
	}
}

func TestExtensionHandler_TransportValidation_BodyLimit(t *testing.T) {
	svc := &mockExtService{}
	r := setupTestRouter(svc)

	// Status payload exceeding 64KB with allowed whitespace
	hugeStatus := bytes.NewBufferString(`{"enabled":true` + strings.Repeat(" ", 70000) + `}`)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest("PUT", "/api/v1/extensions/metrics/status", hugeStatus)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 for oversized status body, got %d", w.Code)
	}

	// Config payload exceeding 1MB with large config_json string value
	hugeConfig := bytes.NewBufferString(`{"config_json":"` + strings.Repeat("a", 1100000) + `"}`)
	w = httptest.NewRecorder()
	req, _ = http.NewRequest("PUT", "/api/v1/extensions/metrics/config", hugeConfig)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("expected 413 for oversized config body, got %d", w.Code)
	}
}

