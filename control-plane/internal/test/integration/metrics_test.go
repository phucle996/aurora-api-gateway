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
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
	w := request("GET", "/api/v1/settings/integrations/metrics", "")
	if w.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200, nhận được: %d, body: %s", w.Code, w.Body.String())
	}
	var defaultCfg map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &defaultCfg); err != nil {
		t.Fatal(err)
	}
	if defaultCfg["mode"] != "disabled" {
		t.Errorf("kỳ vọng mode mặc định là 'disabled', nhận được: %v", defaultCfg["mode"])
	}

	// 2. Trong chế độ mặc định disabled: Gọi lấy timeline metrics của node trả về 503
	wMetricsDisabled := request("GET", "/api/v1/nodes/node-local-01/metrics", "")
	if wMetricsDisabled.Code != http.StatusServiceUnavailable {
		t.Fatalf("kỳ vọng mã lỗi 503 khi metrics đang disabled, nhận: %d", wMetricsDisabled.Code)
	}

	// 3. Kích hoạt chuyển sang chế độ 'standalone' (Lab/Dev mode): Gọi lấy metrics thành công 200 OK
	standalonePayload := `{"mode":"standalone","prometheus_url":"http://127.0.0.1:9090","prometheus_job":"aurora-waf-nodes"}`
	wEnable := request("PUT", "/api/v1/settings/integrations/metrics", standalonePayload)
	if wEnable.Code != http.StatusOK {
		t.Fatalf("kỳ vọng cập nhật sang standalone thành công 200, nhận: %d", wEnable.Code)
	}

	// Đẩy 1 heartbeat protobuf cho node-local-01
	hb := entity.NodeHeartbeatPayload{
		NodeID:            "node-local-01",
		Timestamp:         time.Now().Unix(),
		CPUUsage:          15.5,
		MemoryUsage:       42.0,
		RequestsPerSecond: 250.0,
		ActiveConnections: 18,
		ActiveReleaseID:   1,
	}
	protoBytes := hb.MarshalBinary()
	rHb := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader(protoBytes))
	rHb.Header.Set("Content-Type", "application/x-protobuf")
	rHb.Header.Set("Authorization", "Bearer "+token)
	wHb := httptest.NewRecorder()
	mux.ServeHTTP(wHb, rHb)
	if wHb.Code != http.StatusNoContent {
		t.Fatalf("kỳ vọng mã 204 khi push heartbeat protobuf, nhận: %d", wHb.Code)
	}

	wMetrics := request("GET", "/api/v1/nodes/node-local-01/metrics", "")
	if wMetrics.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200 khi lấy metrics standalone, nhận được: %d, body: %s", wMetrics.Code, wMetrics.Body.String())
	}
	var points []map[string]interface{}
	if err := json.Unmarshal(wMetrics.Body.Bytes(), &points); err != nil {
		t.Fatal(err)
	}
	if len(points) == 0 {
		t.Errorf("kỳ vọng có các điểm đo timeline, nhận được mảng rỗng")
	}

	// 4. Chuyển sang chế độ 'prometheus' với máy chủ offline: Phải trả về 503 kèm PROMETHEUS_UNAVAILABLE
	promPayload := `{"mode":"prometheus","prometheus_url":"http://127.0.0.1:59999","prometheus_job":"aurora-waf"}`
	wProm := request("PUT", "/api/v1/settings/integrations/metrics", promPayload)
	if wProm.Code != http.StatusOK {
		t.Fatalf("kỳ vọng cập nhật sang prometheus thành công 200, nhận: %d", wProm.Code)
	}

	wMetricsPromUnreachable := request("GET", "/api/v1/nodes/node-local-01/metrics", "")
	if wMetricsPromUnreachable.Code != http.StatusServiceUnavailable {
		t.Fatalf("kỳ vọng mã lỗi 503 khi Prometheus offline, nhận: %d", wMetricsPromUnreachable.Code)
	}

	// 5. Kiểm tra tính năng Test Connection tới máy chủ unreachable
	wTest := request("POST", "/api/v1/settings/integrations/metrics/test", `{"url":"http://127.0.0.1:59999"}`)
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

	// 6. Chuyển đổi linh hoạt lại chế độ 'standalone' (Lab/Dev): Hệ thống lập tức phục hồi 200 OK
	wRestore := request("PUT", "/api/v1/settings/integrations/metrics", `{"mode":"standalone","prometheus_url":"http://127.0.0.1:9090","prometheus_job":"aurora-waf"}`)
	if wRestore.Code != http.StatusOK {
		t.Fatalf("kỳ vọng chuyển lại standalone thành công 200, nhận: %d", wRestore.Code)
	}

	wMetricsRestored := request("GET", "/api/v1/nodes/node-local-01/metrics", "")
	if wMetricsRestored.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200 sau khi chuyển lại standalone, nhận: %d", wMetricsRestored.Code)
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

