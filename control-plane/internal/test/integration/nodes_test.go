package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func nodesFixture(t *testing.T) http.Handler {
	t.Helper()
	path := filepath.Join(t.TempDir(), "nodes.db")
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
	module := app.NewModule(pools.Writer, pools.Reader, config.Config{CompilerPath: os.Getenv("AURORA_TEST_COMPILER")})
	app.RegisterRoutes(router, module, "nodes-test-token-at-least-32-bytes")
	return router
}

func TestListNodesWorkflow(t *testing.T) {
	mux := nodesFixture(t)
	token := "nodes-test-token-at-least-32-bytes"

	request := func(method, path, auth string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if auth != "" {
			r.Header.Set("Authorization", "Bearer "+auth)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	// 1. Kiểm tra xác thực: Chưa có token thì phải trả về 401 Unauthorized
	if w := request("GET", "/api/v1/nodes", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("kỳ vọng mã lỗi 401 khi không có token, nhận được: %d", w.Code)
	}

	// 2. Gọi API với token hợp lệ: Kỳ vọng 200 OK
	w := request("GET", "/api/v1/nodes", token)
	if w.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200 OK, nhận được: %d, body: %s", w.Code, w.Body.String())
	}

	var nodes []entity.ClusterNodeRecord
	if err := json.Unmarshal(w.Body.Bytes(), &nodes); err != nil {
		t.Fatalf("giải mã JSON danh sách node thất bại: %v", err)
	}

	// 3. Xác nhận có ít nhất 1 node local đã được seed qua migration v6
	if len(nodes) < 1 {
		t.Fatalf("kỳ vọng ít nhất 1 node trong kết quả, thực tế: %d", len(nodes))
	}

	localNode := nodes[0]
	if localNode.ID != "node-local-01" {
		t.Errorf("kỳ vọng node id là 'node-local-01', thực tế: %s", localNode.ID)
	}
	if localNode.Hostname != "localhost" {
		t.Errorf("kỳ vọng hostname là 'localhost', thực tế: %s", localNode.Hostname)
	}
	if localNode.IP != "127.0.0.1" {
		t.Errorf("kỳ vọng ip là '127.0.0.1', thực tế: %s", localNode.IP)
	}
	if localNode.Status != "Ready" {
		t.Errorf("kỳ vọng status là 'Ready', thực tế: %s", localNode.Status)
	}

	// 4. Kiểm tra lấy chi tiết node qua GET /api/v1/nodes/:id
	wDetail := request("GET", "/api/v1/nodes/node-local-01", token)
	if wDetail.Code != http.StatusOK {
		t.Fatalf("kỳ vọng chi tiết node trả về 200, nhận được: %d", wDetail.Code)
	}
	var detail entity.ClusterNodeRecord
	if err := json.Unmarshal(wDetail.Body.Bytes(), &detail); err != nil {
		t.Fatalf("giải mã JSON chi tiết node thất bại: %v", err)
	}
	if detail.ID != "node-local-01" || detail.Hostname != "localhost" {
		t.Errorf("dữ liệu chi tiết node không khớp: %+v", detail)
	}

	// 5. Kiểm tra node không tồn tại trả về 404
	wNotFound := request("GET", "/api/v1/nodes/non-existent-node", token)
	if wNotFound.Code != http.StatusNotFound {
		t.Errorf("kỳ vọng mã 404 cho node không tồn tại, nhận được: %d", wNotFound.Code)
	}
}
