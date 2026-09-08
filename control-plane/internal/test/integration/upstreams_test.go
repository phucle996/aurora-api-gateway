package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

func upstreamsFixture(t *testing.T) http.Handler {
	t.Helper()
	path := filepath.Join(t.TempDir(), "upstreams.db")
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
	app.RegisterRoutes(router, module, "upstreams-test-token-at-least-32-bytes")
	return router
}

func TestUpstreamsWorkflow_CreateAndSync(t *testing.T) {
	handler := upstreamsFixture(t)
	token := "upstreams-test-token-at-least-32-bytes"

	// 1. Tạo mới một Upstream Pool hợp lệ
	createPayload := dto.CreateUpstreamRequest{
		Name:             "payment-gateway-pool",
		Description:      "Core payment microservice backend cluster",
		ArchitectureType: "Load Balancer",
		Algorithm:        "least_conn",
		Servers: []entity.UpstreamNode{
			{
				ID:      "srv-1",
				Address: "10.0.10.20:8443",
				Weight:  2,
				Healthy: true,
			},
			{
				ID:      "srv-2",
				Address: "10.0.10.21:8443",
				Weight:  1,
				Healthy: true,
			},
		},
		InternalSSL: entity.UpstreamInternalSSL{
			Enabled:    true,
			VerifyCert: true,
			SNIHost:    "payment.internal",
		},
		Transport: entity.UpstreamTransport{
			HTTPVersion:          "HTTP/1.1",
			EnableWebSocket:      true,
			KeepAliveConnections: 64,
		},
	}

	bodyBytes, _ := json.Marshal(createPayload)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/upstreams", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var created entity.UpstreamItem
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("failed to decode created upstream: %v", err)
	}

	if created.Name != "payment-gateway-pool" {
		t.Errorf("expected name payment-gateway-pool, got %s", created.Name)
	}
	if len(created.Servers) != 2 {
		t.Errorf("expected 2 servers, got %d", len(created.Servers))
	}

	// 2. Thử tạo lại với cùng tên -> phải bị từ chối 400 Bad Request
	reqDup := httptest.NewRequest(http.MethodPost, "/api/v1/upstreams", bytes.NewReader(bodyBytes))
	reqDup.Header.Set("Content-Type", "application/json")
	reqDup.Header.Set("Authorization", "Bearer "+token)

	wDup := httptest.NewRecorder()
	handler.ServeHTTP(wDup, reqDup)
	if wDup.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on duplicate name, got %d", wDup.Code)
	}

	// 3. Truy vấn danh sách Upstream -> phải thấy upstream vừa tạo
	reqList := httptest.NewRequest(http.MethodGet, "/api/v1/upstreams", nil)
	reqList.Header.Set("Authorization", "Bearer "+token)
	wList := httptest.NewRecorder()
	handler.ServeHTTP(wList, reqList)

	if wList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on list, got %d: %s", wList.Code, wList.Body.String())
	}

	var listResp struct {
		Items []entity.UpstreamItem `json:"items"`
		Total int                   `json:"total"`
	}
	if err := json.Unmarshal(wList.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}

	if listResp.Total < 1 {
		t.Errorf("expected at least 1 upstream, got %d", listResp.Total)
	}

	// 4. Data Plane node kéo snapshot qua /api/v1/upstream-sync/:node
	reqSync := httptest.NewRequest(http.MethodGet, "/api/v1/upstream-sync/node-01", nil)
	reqSync.Header.Set("Authorization", "Bearer "+token)
	wSync := httptest.NewRecorder()
	handler.ServeHTTP(wSync, reqSync)

	if wSync.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on sync, got %d: %s", wSync.Code, wSync.Body.String())
	}

	var snapshot entity.UpstreamSnapshot
	if err := json.Unmarshal(wSync.Body.Bytes(), &snapshot); err != nil {
		t.Fatalf("failed to decode snapshot: %v", err)
	}

	if snapshot.ReleaseID < 1 {
		t.Errorf("expected release_id >= 1, got %d", snapshot.ReleaseID)
	}
	if snapshot.Digest == "" {
		t.Error("expected non-empty digest")
	}
	if snapshot.ConfigContent == "" {
		t.Error("expected non-empty config_content for NGINX")
	}

	// 5. Node gửi report xác nhận đã nạp và reload
	reportPayload := dto.UpstreamSyncReportRequest{
		ReleaseID: snapshot.ReleaseID,
		Phase:     "applied",
		Message:   "Upstream directives synced and NGINX reloaded successfully",
	}
	repBytes, _ := json.Marshal(reportPayload)
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/upstream-sync/node-01", bytes.NewReader(repBytes))
	reqRep.Header.Set("Content-Type", "application/json")
	reqRep.Header.Set("Authorization", "Bearer "+token)

	wRep := httptest.NewRecorder()
	handler.ServeHTTP(wRep, reqRep)

	if wRep.Code != http.StatusNoContent {
		t.Errorf("expected 204 No Content on report, got %d", wRep.Code)
	}

	// 6. Cập nhật Upstream qua PUT /api/v1/upstreams/:id
	updatePayload := dto.UpdateUpstreamRequest{
		Name:             "payment-gateway-updated",
		Description:      "Updated payment cluster",
		ArchitectureType: "Load Balancer",
		Algorithm:        "least_conn",
		Servers: []entity.UpstreamNode{
			{
				ID:      "srv-1",
				Address: "192.168.10.1:8080",
				Weight:  5,
				Healthy: true,
			},
			{
				ID:      "srv-2",
				Address: "192.168.10.2:8080",
				Weight:  1,
				Healthy: true,
			},
		},
		InternalSSL: entity.UpstreamInternalSSL{
			Enabled:    true,
			VerifyCert: false,
			SNIHost:    "internal.payment.io",
		},
		Transport: entity.UpstreamTransport{
			HTTPVersion:          "HTTP/1.1",
			KeepAliveConnections: 64,
		},
	}
	upBytes, _ := json.Marshal(updatePayload)
	reqUpdate := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/v1/upstreams/%d", created.ID), bytes.NewReader(upBytes))
	reqUpdate.Header.Set("Content-Type", "application/json")
	reqUpdate.Header.Set("Authorization", "Bearer "+token)

	wUpdate := httptest.NewRecorder()
	handler.ServeHTTP(wUpdate, reqUpdate)

	if wUpdate.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on update, got %d: %s", wUpdate.Code, wUpdate.Body.String())
	}

	var updated entity.UpstreamItem
	if err := json.Unmarshal(wUpdate.Body.Bytes(), &updated); err != nil {
		t.Fatalf("failed to decode updated upstream: %v", err)
	}

	if updated.Name != "payment-gateway-updated" {
		t.Errorf("expected updated name payment-gateway-updated, got %s", updated.Name)
	}
	if updated.Version != 2 {
		t.Errorf("expected version 2, got %d", updated.Version)
	}
	if updated.Algorithm != "least_conn" {
		t.Errorf("expected algorithm least_conn, got %s", updated.Algorithm)
	}

	// 7. Data Plane node kéo lại snapshot -> phải thấy release 2
	reqSync2 := httptest.NewRequest(http.MethodGet, "/api/v1/upstream-sync/node-01", nil)
	reqSync2.Header.Set("Authorization", "Bearer "+token)
	wSync2 := httptest.NewRecorder()
	handler.ServeHTTP(wSync2, reqSync2)

	if wSync2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on sync2, got %d", wSync2.Code)
	}

	var snapshot2 entity.UpstreamSnapshot
	if err := json.Unmarshal(wSync2.Body.Bytes(), &snapshot2); err != nil {
		t.Fatalf("failed to decode snapshot2: %v", err)
	}
	if snapshot2.ReleaseID != 2 {
		t.Errorf("expected release_id 2, got %d", snapshot2.ReleaseID)
	}
	if !strings.Contains(snapshot2.ConfigContent, "payment-gateway-updated") {
		t.Errorf("expected config to contain payment-gateway-updated, got:\n%s", snapshot2.ConfigContent)
	}
	if !strings.Contains(snapshot2.ConfigContent, "least_conn;") {
		t.Errorf("expected config to contain least_conn, got:\n%s", snapshot2.ConfigContent)
	}

	// 8. Xóa Upstream qua DELETE /api/v1/upstreams/:id
	reqDelete := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/v1/upstreams/%d", created.ID), nil)
	reqDelete.Header.Set("Authorization", "Bearer "+token)
	wDelete := httptest.NewRecorder()
	handler.ServeHTTP(wDelete, reqDelete)

	if wDelete.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on delete, got %d: %s", wDelete.Code, wDelete.Body.String())
	}

	// 9. Kiểm tra lấy lại ID đã xóa -> 404
	reqGetDeleted := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/upstreams/%d", created.ID), nil)
	reqGetDeleted.Header.Set("Authorization", "Bearer "+token)
	wGetDeleted := httptest.NewRecorder()
	handler.ServeHTTP(wGetDeleted, reqGetDeleted)

	if wGetDeleted.Code != http.StatusNotFound {
		t.Fatalf("expected 404 on deleted upstream, got %d", wGetDeleted.Code)
	}

	// 10. Snapshot release 3 -> rỗng
	reqSync3 := httptest.NewRequest(http.MethodGet, "/api/v1/upstream-sync/node-01", nil)
	reqSync3.Header.Set("Authorization", "Bearer "+token)
	wSync3 := httptest.NewRecorder()
	handler.ServeHTTP(wSync3, reqSync3)

	var snapshot3 entity.UpstreamSnapshot
	_ = json.Unmarshal(wSync3.Body.Bytes(), &snapshot3)
	if snapshot3.ReleaseID != 3 {
		t.Errorf("expected release_id 3 after deletion, got %d", snapshot3.ReleaseID)
	}
	if len(snapshot3.Upstreams) != 0 {
		t.Errorf("expected 0 upstreams in snapshot3, got %d", len(snapshot3.Upstreams))
	}
}
