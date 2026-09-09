package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"github.com/gin-gonic/gin"
)

const rollingTestToken = "nodes-test-token-at-least-32-bytes"

func rollingFixture(t *testing.T) (*infra.DBPool, http.Handler) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rolling.db")
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
	pools.Writer.Exec("INSERT INTO cluster_nodes (id, name, hostname, ip, role, status, version, sync_status, join_method, certificate) VALUES ('node-local-01', 'node-local-01', '', '127.0.0.1', 'Edge Node', 'Ready', '0.4.1', 'In Sync', 'Unknown', 'Unknown')")
	module := app.NewModule(pools.Writer, pools.Reader, config.Config{})
	app.RegisterRoutes(router, module, rollingTestToken)
	return pools, router
}

func TestNodeReloadDirectives(t *testing.T) {
	_, mux := rollingFixture(t)

	// 1. Kích hoạt reload cho node-local-01
	reqReload := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/reload", nil)
	reqReload.Header.Set("Authorization", "Bearer "+rollingTestToken)
	wReload := httptest.NewRecorder()
	mux.ServeHTTP(wReload, reqReload)
	if wReload.Code != http.StatusOK {
		t.Fatalf("kỳ vọng mã 200 kích hoạt reload node, nhận: %d, body: %s", wReload.Code, wReload.Body.String())
	}

	// 2. Node gửi heartbeat lần 1: Phải nhận được chỉ thị reload_process
	hb1 := entity.NodeHeartbeatPayload{
		WorkerIdentity: "worker-before",
		NodeID:         "node-local-01",
		Timestamp:      time.Now().Unix(),
		CPUUsage:       15.0,
	}
	rHb1 := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader(hb1.MarshalBinary()))
	rHb1.Header.Set("Content-Type", "application/x-protobuf")
	rHb1.Header.Set("Authorization", "Bearer "+rollingTestToken)
	wHb1 := httptest.NewRecorder()
	mux.ServeHTTP(wHb1, rHb1)
	if wHb1.Code != http.StatusOK {
		t.Fatalf("heartbeat 1 thất bại: %d", wHb1.Code)
	}

	var d1 entity.NodeCommandDirective
	if err := json.Unmarshal(wHb1.Body.Bytes(), &d1); err != nil {
		t.Fatal(err)
	}
	if d1.Action != "reload_process" {
		t.Fatalf("kỳ vọng action là 'reload_process', nhận: %q", d1.Action)
	}

	// 3. Node gửi heartbeat lần 2 (sau khi reload xong): Lệnh phải trở về 'none'
	hb2 := entity.NodeHeartbeatPayload{
		WorkerIdentity: "worker-after",
		NodeID:         "node-local-01",
		Timestamp:      time.Now().Unix() + 1,
		CPUUsage:       10.0,
	}
	rHb2 := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader(hb2.MarshalBinary()))
	rHb2.Header.Set("Content-Type", "application/x-protobuf")
	rHb2.Header.Set("Authorization", "Bearer "+rollingTestToken)
	wHb2 := httptest.NewRecorder()
	mux.ServeHTTP(wHb2, rHb2)

	var d2 entity.NodeCommandDirective
	if err := json.Unmarshal(wHb2.Body.Bytes(), &d2); err != nil {
		t.Fatal(err)
	}
	if d2.Action != "none" {
		t.Fatalf("sau khi hoàn tất reload, action phải là 'none', nhận: %q", d2.Action)
	}
}

func TestRollingReloadQueue(t *testing.T) {
	pools, mux := rollingFixture(t)

	// Thêm node 2 và node 3 vào SQLite
	_, err := pools.Writer.Exec(`
		INSERT INTO cluster_nodes (id, name, ip, status)
		VALUES ('node-local-02', 'node-local-02', '127.0.0.2', 'Ready'),
		       ('node-local-03', 'node-local-03', '127.0.0.3', 'Ready');
	`)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Kích hoạt Rolling Reload
	reqRolling := httptest.NewRequest("POST", "/api/v1/nodes/rolling-reload", nil)
	reqRolling.Header.Set("Authorization", "Bearer "+rollingTestToken)
	wRolling := httptest.NewRecorder()
	mux.ServeHTTP(wRolling, reqRolling)
	if wRolling.Code != http.StatusOK {
		t.Fatalf("kích hoạt rolling reload thất bại: %d, body: %s", wRolling.Code, wRolling.Body.String())
	}

	var rollStatus entity.RollingStatus
	if err := json.Unmarshal(wRolling.Body.Bytes(), &rollStatus); err != nil {
		t.Fatal(err)
	}
	if !rollStatus.Active {
		t.Fatal("rolling status phải là active")
	}

	// 2. Node 2 gửi heartbeat: Phải là 'none' vì Node 1 đang được ưu tiên reload trước
	hbNode2 := entity.NodeHeartbeatPayload{NodeID: "node-local-02", Timestamp: time.Now().Unix()}
	r2 := httptest.NewRequest("POST", "/api/v1/nodes/node-local-02/heartbeat", bytes.NewReader(hbNode2.MarshalBinary()))
	r2.Header.Set("Content-Type", "application/x-protobuf")
	r2.Header.Set("Authorization", "Bearer "+rollingTestToken)
	w2 := httptest.NewRecorder()
	mux.ServeHTTP(w2, r2)
	var dNode2 entity.NodeCommandDirective
	_ = json.Unmarshal(w2.Body.Bytes(), &dNode2)
	if dNode2.Action != "none" {
		t.Fatalf("Node 2 phải ở trạng thái chờ (action: none), nhận: %s", dNode2.Action)
	}

	// 3. Node 1 gửi heartbeat: Nhận lệnh reload_process
	hbNode1 := entity.NodeHeartbeatPayload{WorkerIdentity: "before", NodeID: "node-local-01", Timestamp: time.Now().Unix()}
	r1 := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader(hbNode1.MarshalBinary()))
	r1.Header.Set("Content-Type", "application/x-protobuf")
	r1.Header.Set("Authorization", "Bearer "+rollingTestToken)
	w1 := httptest.NewRecorder()
	mux.ServeHTTP(w1, r1)
	var dNode1 entity.NodeCommandDirective
	_ = json.Unmarshal(w1.Body.Bytes(), &dNode1)
	if dNode1.Action != "reload_process" {
		t.Fatalf("Node 1 phải nhận action 'reload_process', nhận: %s", dNode1.Action)
	}

	// 4. Node 1 hoàn tất reload và gửi heartbeat xác nhận:
	// Hệ thống phải tự động chuyển quyền reload sang Node 2!
	hbNode1Done := entity.NodeHeartbeatPayload{WorkerIdentity: "after", NodeID: "node-local-01", Timestamp: time.Now().Unix() + 1}
	r1Done := httptest.NewRequest("POST", "/api/v1/nodes/node-local-01/heartbeat", bytes.NewReader(hbNode1Done.MarshalBinary()))
	r1Done.Header.Set("Content-Type", "application/x-protobuf")
	r1Done.Header.Set("Authorization", "Bearer "+rollingTestToken)
	w1Done := httptest.NewRecorder()
	mux.ServeHTTP(w1Done, r1Done)

	// 5. Node 2 gửi heartbeat kế tiếp: Lập tức nhận được 'reload_process'!
	hbNode2.Timestamp++
	r2Next := httptest.NewRequest("POST", "/api/v1/nodes/node-local-02/heartbeat", bytes.NewReader(hbNode2.MarshalBinary()))
	r2Next.Header.Set("Content-Type", "application/x-protobuf")
	r2Next.Header.Set("Authorization", "Bearer "+rollingTestToken)
	w2Next := httptest.NewRecorder()
	mux.ServeHTTP(w2Next, r2Next)
	var dNode2Next entity.NodeCommandDirective
	_ = json.Unmarshal(w2Next.Body.Bytes(), &dNode2Next)
	if dNode2Next.Action != "reload_process" {
		t.Fatalf("sau khi Node 1 xong, Node 2 phải nhận 'reload_process', nhận: %s", dNode2Next.Action)
	}
}
