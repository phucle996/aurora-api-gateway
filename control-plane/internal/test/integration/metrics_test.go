package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

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
