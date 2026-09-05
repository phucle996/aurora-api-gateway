package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

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

func TestNodeHeartbeatWorkflow(t *testing.T) {
	mux := nodesFixture(t)
	token := "nodes-test-token-at-least-32-bytes"

	// 1. Kiểm tra từ chối định dạng JSON: bắt buộc 100% Protobuf binary wire format
	reqJSON := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewBufferString(`{"status":"online"}`))
	reqJSON.Header.Set("Content-Type", "application/json")
	reqJSON.Header.Set("Authorization", "Bearer "+token)
	wJSON := httptest.NewRecorder()
	mux.ServeHTTP(wJSON, reqJSON)
	if wJSON.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("kỳ vọng mã 415 khi gửi application/json, nhận: %d", wJSON.Code)
	}

	// 2. Kiểm tra từ chối binary rác/hỏng
	reqCorrupt := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader([]byte{0xFF, 0xFF, 0xFF, 0xFF}))
	reqCorrupt.Header.Set("Content-Type", "application/x-protobuf")
	reqCorrupt.Header.Set("Authorization", "Bearer "+token)
	wCorrupt := httptest.NewRecorder()
	mux.ServeHTTP(wCorrupt, reqCorrupt)
	if wCorrupt.Code != http.StatusBadRequest {
		t.Fatalf("kỳ vọng mã 400 khi gửi binary không hợp lệ, nhận: %d", wCorrupt.Code)
	}

	// 3. Kiểm tra từ chối khi node_id không khớp URL path
	mismatchPayload := entity.NodeHeartbeatPayload{
		NodeID:    "other-node",
		Timestamp: time.Now().Unix(),
	}
	reqMismatch := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader(mismatchPayload.MarshalBinary()))
	reqMismatch.Header.Set("Content-Type", "application/x-protobuf")
	reqMismatch.Header.Set("Authorization", "Bearer "+token)
	wMismatch := httptest.NewRecorder()
	mux.ServeHTTP(wMismatch, reqMismatch)
	if wMismatch.Code != http.StatusBadRequest {
		t.Fatalf("kỳ vọng mã 400 khi node_id không khớp URL, nhận: %d", wMismatch.Code)
	}

	// 4. Gửi heartbeat Protobuf binary hợp lệ thành công
	hb := entity.NodeHeartbeatPayload{
		NodeID:            "node-local-01",
		Timestamp:         time.Now().Unix(),
		CPUUsage:          22.5,
		MemoryUsage:       65.0,
		RequestsPerSecond: 320.0,
		ActiveConnections: 42,
	}
	protoBytes := hb.MarshalBinary()
	reqValid := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader(protoBytes))
	reqValid.Header.Set("Content-Type", "application/x-protobuf")
	reqValid.Header.Set("Authorization", "Bearer "+token)
	wValid := httptest.NewRecorder()
	mux.ServeHTTP(wValid, reqValid)
	if wValid.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200 OK khi gửi protobuf thành công, nhận: %d, body: %s", wValid.Code, wValid.Body.String())
	}
	var dirResp struct {
		Action           string `json:"action"`
		DesiredReleaseID int64  `json:"desired_release_id"`
	}
	if err := json.Unmarshal(wValid.Body.Bytes(), &dirResp); err != nil {
		t.Fatalf("kỳ vọng parse được JSON directive từ heartbeat response: %v", err)
	}

	// 5. Kiểm tra chi tiết node sau khi cập nhật heartbeat
	reqDetail := httptest.NewRequest("GET", "/api/v1/nodes/node-local-01", nil)
	reqDetail.Header.Set("Authorization", "Bearer "+token)
	wDetail := httptest.NewRecorder()
	mux.ServeHTTP(wDetail, reqDetail)
	if wDetail.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200 lấy thông tin node, nhận: %d", wDetail.Code)
	}
	var node entity.ClusterNodeRecord
	if err := json.Unmarshal(wDetail.Body.Bytes(), &node); err != nil {
		t.Fatal(err)
	}
	if node.Status != "Ready" {
		t.Errorf("kỳ vọng node status là 'Ready', nhận: %s", node.Status)
	}
	if node.CPUUsage != 22.5 {
		t.Errorf("kỳ vọng CPUUsage = 22.5, nhận: %f", node.CPUUsage)
	}
	if node.MemoryUsage != 65.0 {
		t.Errorf("kỳ vọng MemoryUsage = 65.0, nhận: %f", node.MemoryUsage)
	}
	if node.ActiveConnections != "42" {
		t.Errorf("kỳ vọng ActiveConnections = '42', nhận: %s", node.ActiveConnections)
	}
	if node.RequestsPerSecond != "320.0" {
		t.Errorf("kỳ vọng RequestsPerSecond = '320.0', nhận: %s", node.RequestsPerSecond)
	}
}

