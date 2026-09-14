package handler_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

func BenchmarkExtensionHandler_List(b *testing.B) {
	svc := &mockExtService{
		listFn: func(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
			return []entity.ExtensionRecord{
				{ID: "std-log", Name: "Standard Stream Logs", Enabled: true},
				{ID: "opentelemetry-logs", Name: "OpenTelemetry Logs", Enabled: true},
				{ID: "prometheus", Name: "Prometheus Metrics", Enabled: true},
			}, nil
		},
	}
	router := setupTestRouter(svc)

	req, err := http.NewRequest("GET", "/api/v1/extensions", nil)
	if err != nil {
		b.Fatalf("failed to create request: %v", err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			b.Fatalf("expected status 200, got %d", w.Code)
		}
	}
}

func BenchmarkExtensionHandler_UpdateStatus(b *testing.B) {
	svc := &mockExtService{
		updateStatusFn: func(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
			return nil
		},
	}
	router := setupTestRouter(svc)
	payload := []byte(`{"enabled":true}`)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req, _ := http.NewRequest("PUT", "/api/v1/extensions/std-log/status", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			b.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}
	}
}

func BenchmarkExtensionHandler_UpdateConfig(b *testing.B) {
	svc := &mockExtService{
		updateConfigFn: func(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
			return nil
		},
	}
	router := setupTestRouter(svc)
	payload := []byte(`{"config_json":"{\"enabled\":true,\"format\":\"json\",\"split_streams\":true,\"log_level\":\"info\",\"include_waf_details\":true}"}`)

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		req, _ := http.NewRequest("PUT", "/api/v1/extensions/std-log/config", bytes.NewReader(payload))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			b.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}
	}
}
