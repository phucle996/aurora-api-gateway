package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func metricsFixture(t *testing.T) http.Handler {
	t.Helper()
	path := filepath.Join(t.TempDir(), "metrics.db")
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

	router := gin.New()
	module := app.NewModule(pools.Writer, pools.Reader, config.Config{})
	app.RegisterRoutes(router, module, "metrics-test-token-at-least-32-bytes")
	return router
}

func TestMetricsFlexibilityLabAndProduction(t *testing.T) {
	mux := metricsFixture(t)
	token := "metrics-test-token-at-least-32-bytes"

	request := func(method, path, body string) *httptest.ResponseRecorder {
		var reqBody *bytes.Buffer
		if body != "" {
			reqBody = bytes.NewBufferString(body)
		} else {
			reqBody = bytes.NewBuffer(nil)
		}
		r := httptest.NewRequest(method, path, reqBody)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	// 1. Kiểm tra cấu hình mặc định ban đầu là 'disabled'
	w := request("GET", "/api/v1/analytics/connection", "")
	if w.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200, nhận được: %d, body: %s", w.Code, w.Body.String())
	}
	var defaultConn map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &defaultConn); err != nil {
		t.Fatal(err)
	}
	cfgMap, _ := defaultConn["config"].(map[string]interface{})
	if cfgMap["mode"] != "disabled" {
		t.Errorf("kỳ vọng mode mặc định là 'disabled', nhận được: %v", cfgMap["mode"])
	}

	// 2. Trong chế độ mặc định disabled: Gọi truy vấn analytics trả về 503
	analyticsQueryPayload := `{
		"source_id": "prometheus",
		"queries": [
			{"id": "A", "metric_key": "traffic.requests_rate", "aggregation": "sum", "filters": {"node_id": "node-local-01"}}
		]
	}`
	wMetricsDisabled := request("POST", "/api/v1/analytics/query", analyticsQueryPayload)
	if wMetricsDisabled.Code != http.StatusServiceUnavailable {
		t.Fatalf("kỳ vọng mã lỗi 503 khi metrics đang disabled, nhận: %d", wMetricsDisabled.Code)
	}

	// 3. Chuyển sang chế độ 'prometheus' với máy chủ offline: Phải trả về 503 kèm PROMETHEUS_UNAVAILABLE
	promPayload := `{"mode":"prometheus","prometheus_url":"http://127.0.0.1:59999","prometheus_job":"aurora-waf"}`
	wProm := request("PUT", "/api/v1/analytics/connection", promPayload)
	if wProm.Code != http.StatusOK {
		t.Fatalf("kỳ vọng cập nhật sang prometheus thành công 200, nhận: %d", wProm.Code)
	}

	wMetricsPromUnreachable := request("POST", "/api/v1/analytics/query", analyticsQueryPayload)
	if wMetricsPromUnreachable.Code != http.StatusServiceUnavailable {
		t.Fatalf("kỳ vọng mã lỗi 503 khi Prometheus offline, nhận: %d", wMetricsPromUnreachable.Code)
	}

	// 4. Kiểm tra tính năng Test Connection tới máy chủ unreachable
	wTest := request("POST", "/api/v1/analytics/connection/test", `{"mode":"prometheus","prometheus_url":"http://127.0.0.1:59999"}`)
	if wTest.Code != http.StatusOK {
		t.Fatalf("kỳ vọng endpoint test connection trả về 200, nhận: %d", wTest.Code)
	}
	var testRes map[string]interface{}
	if err := json.Unmarshal(wTest.Body.Bytes(), &testRes); err != nil {
		t.Fatal(err)
	}
	if testRes["success"] == true {
		t.Errorf("kỳ vọng test connection thất bại cho cổng không tồn tại")
	}

	// 5. Giả lập một Prometheus Server Online với endpoint /api/v1/query_range & /api/v1/query
	mockProm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "query_range") {
			now := time.Now().Unix()
			series := []any{}
			for _, name := range []string{"aurora_node_requests_per_second", "nginx_http_requests_total"} {
				values := []any{[]any{float64(now - 60), "15.5"}, []any{float64(now), "18.2"}}
				series = append(series, map[string]any{"metric": map[string]string{"__name__": name, "node_id": "node-local-01", "status": "200"}, "values": values})
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "matrix", "result": series}})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "vector", "result": []any{
			map[string]any{"metric": map[string]string{}, "value": []any{float64(time.Now().Unix()), "1"}},
		}}})
	}))
	defer mockProm.Close()

	wPromOnline := request("PUT", "/api/v1/analytics/connection", fmt.Sprintf(`{"mode":"prometheus","prometheus_url":"%s","prometheus_job":"aurora-waf"}`, mockProm.URL))
	if wPromOnline.Code != http.StatusOK {
		t.Fatalf("kỳ vọng cập nhật sang mock prometheus thành công, nhận: %d", wPromOnline.Code)
	}

	// 5a. Kiểm tra endpoint Metric Catalog
	wCatalog := request("GET", "/api/v1/analytics/catalog", "")
	if wCatalog.Code != http.StatusOK {
		t.Fatalf("kỳ vọng catalog 200, nhận: %d, body: %s", wCatalog.Code, wCatalog.Body.String())
	}
	var catalogBody map[string]any
	if err := json.Unmarshal(wCatalog.Body.Bytes(), &catalogBody); err != nil {
		t.Fatal(err)
	}
	if categories, ok := catalogBody["categories"].([]any); !ok || len(categories) == 0 {
		t.Errorf("kỳ vọng categories trong catalog")
	}

	// 5b. Kiểm tra endpoint Analytics Query theo semantic keys
	wAnalytics := request("POST", "/api/v1/analytics/query", analyticsQueryPayload)
	if wAnalytics.Code != http.StatusOK {
		t.Fatalf("kỳ vọng analytics query 200, nhận: %d, body: %s", wAnalytics.Code, wAnalytics.Body.String())
	}
	var analyticsRes map[string]any
	if err := json.Unmarshal(wAnalytics.Body.Bytes(), &analyticsRes); err != nil {
		t.Fatal(err)
	}
	seriesList, ok := analyticsRes["series"].([]any)
	if !ok || len(seriesList) == 0 {
		t.Errorf("kỳ vọng có series trả về từ analytics query")
	}

	// 6. Vô hiệu hóa metrics -> API analytics lập tức trả về 503 METRICS_DISABLED
	wDisable := request("PUT", "/api/v1/analytics/connection", `{"mode":"disabled"}`)
	if wDisable.Code != http.StatusOK {
		t.Fatalf("kỳ vọng chuyển sang disabled thành công 200, nhận: %d", wDisable.Code)
	}
	wMetricsDisabledAgain := request("POST", "/api/v1/analytics/query", analyticsQueryPayload)
	if wMetricsDisabledAgain.Code != http.StatusServiceUnavailable {
		t.Fatalf("kỳ vọng 503 khi disabled, nhận: %d", wMetricsDisabledAgain.Code)
	}
}

func TestBatchedMetricsHistoryCleanupWithPacing(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cleanup.db")
	a, err := app.NewApp(context.Background(), config.Config{SQLitePath: path})
	if err != nil {
		t.Fatal(err)
	}
	a.Close()

	pools, err := infra.OpenSQLitePool(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()

	nodeRepo := repository.NewNodeRepository(pools.Writer)
	now := time.Now().Unix()

	// 1. Tạo 1200 bản ghi cũ quá 10 ngày (> retention 7 ngày)
	var oldRecords []entity.NodeMetricHistoryRecord
	for i := 0; i < 1200; i++ {
		oldRecords = append(oldRecords, entity.NodeMetricHistoryRecord{
			NodeID:            "node-local-01",
			Timestamp:         now - (10*86400 + int64(i)),
			CPUUsage:          10.0,
			MemoryUsage:       20.0,
			ActiveConnections: 5,
			RequestsPerSecond: 100.0,
		})
	}
	if err := nodeRepo.BatchInsertMetricsHistory(context.Background(), oldRecords); err != nil {
		t.Fatalf("insert old records: %v", err)
	}

	// 2. Tạo 10 bản ghi mới (hôm nay, còn trong hạn 7 ngày)
	var freshRecords []entity.NodeMetricHistoryRecord
	for i := 0; i < 10; i++ {
		freshRecords = append(freshRecords, entity.NodeMetricHistoryRecord{
			NodeID:            "node-local-01",
			Timestamp:         now - int64(i*60),
			CPUUsage:          15.0,
			MemoryUsage:       25.0,
			ActiveConnections: 12,
			RequestsPerSecond: 200.0,
		})
	}
	if err := nodeRepo.BatchInsertMetricsHistory(context.Background(), freshRecords); err != nil {
		t.Fatalf("insert fresh records: %v", err)
	}

	// 3. Thực hiện CleanupExpiredMetricsHistory (chạy batch 500 dòng/lần với pacing 30ms)
	start := time.Now()
	if err := nodeRepo.CleanupExpiredMetricsHistory(context.Background(), 7); err != nil {
		t.Fatalf("cleanup failed: %v", err)
	}
	elapsed := time.Since(start)

	// Vì có 1200 bản ghi, sẽ chia thành:
	// Batch 1: 500 dòng (pacing 30ms)
	// Batch 2: 500 dòng (pacing 30ms)
	// Batch 3: 200 dòng (< 500 dòng -> dừng)
	// Tổng pacing tối thiểu là ~60ms
	if elapsed < 50*time.Millisecond {
		t.Errorf("kỳ vọng có pacing giữa các batch (>50ms), thực tế: %v", elapsed)
	}

	// 4. Kiểm tra số lượng bản ghi còn lại trong SQLite: phải đúng 10 bản ghi tươi mới
	var count int
	if err := pools.Reader.QueryRow("SELECT count(*) FROM node_metrics_history WHERE node_id = 'node-local-01'").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 10 {
		t.Fatalf("kỳ vọng còn lại 10 bản ghi mới, thực tế còn: %d", count)
	}
}
