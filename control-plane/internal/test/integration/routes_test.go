package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/migrations"
	"github.com/gin-gonic/gin"
)

func routesFixture(t *testing.T) (http.Handler, string) {
	gin.SetMode(gin.TestMode)
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "routes.db")
	db, err := infra.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}

	for _, m := range []string{
		migrations.Tables,
		migrations.Seeds,
	} {
		if _, err := db.Exec(m); err != nil {
			t.Fatalf("migration failed: %v", err)
		}
	}

	// Seed upstreams for route binding
	_, err = db.Exec(`
		INSERT INTO upstreams (name, description, architecture_type, algorithm, servers_json)
		VALUES ('payment_cluster', 'Payment Service', 'Load Balancer', 'round_robin', '[{"address":"10.0.1.20:8080","weight":1}]'),
		       ('auth_cluster', 'Auth Service', 'Single Server', 'round_robin', '[{"address":"10.0.1.21:8080","weight":1}]');
	`)
	if err != nil {
		t.Fatal(err)
	}

	cfg := config.Config{
		SQLitePath: path,
		JWTSecret:  "routes-test-token-at-least-32-bytes",
	}
	module, err := app.NewModule(db, db, cfg)
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	token := "routes-operator-secret-token"
	app.RegisterRoutes(router, module, token)
	return router, token
}

func TestRoutesCRUDAndUpstreamProtection(t *testing.T) {
	handler, token := routesFixture(t)

	request := func(method, path string, body interface{}, wantCode int) map[string]interface{} {
		var reqBody []byte
		if body != nil {
			reqBody, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(reqBody))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		if w.Code != wantCode {
			t.Fatalf("%s %s expected status %d, got %d: %s", method, path, wantCode, w.Code, w.Body.String())
		}
		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		return res
	}

	// 1. Tạo route thành công
	createRes := request("POST", "/api/v1/routes", map[string]interface{}{
		"name":          "Checkout Route",
		"host":          "api.aurora.local",
		"path":          "/api/v1/checkout",
		"upstream_name": "payment_cluster",
		"enabled":       true,
		"priority":      100,
		"plugins_json":  `{"uri-rewrite":{"rules":[{"match_header":{"X-API-Version":"2"},"rewrite_path":"/v2/checkout"}]}}`,
		"description":   "Main checkout endpoint",
	}, 201)

	routeID := createRes["id"].(string)
	if routeID == "" {
		t.Fatal("expected non-empty route ID")
	}

	// 2. Tạo route thất bại do upstream không tồn tại
	request("POST", "/api/v1/routes", map[string]interface{}{
		"name":          "Invalid Upstream Route",
		"host":          "api.aurora.local",
		"path":          "/api/v1/fail",
		"upstream_name": "non_existent_cluster",
	}, 400)

	// 3. Tạo route thất bại do path không bắt đầu bằng /
	request("POST", "/api/v1/routes", map[string]interface{}{
		"name":          "Invalid Path Route",
		"host":          "api.aurora.local",
		"path":          "api/v1/fail",
		"upstream_name": "payment_cluster",
	}, 400)

	// 4. Lấy chi tiết route
	getRes := request("GET", fmt.Sprintf("/api/v1/routes/%s", routeID), nil, 200)
	if getRes["name"] != "Checkout Route" || getRes["host"] != "api.aurora.local" {
		t.Fatalf("unexpected route details: %v", getRes)
	}

	// 5. Cập nhật route
	updateRes := request("PUT", fmt.Sprintf("/api/v1/routes/%s", routeID), map[string]interface{}{
		"name":          "Checkout Route v2",
		"host":          "api.aurora.local",
		"path":          "/api/v2/checkout",
		"upstream_name": "payment_cluster",
		"enabled":       true,
		"priority":      200,
	}, 200)
	if updateRes["name"] != "Checkout Route v2" || updateRes["path"] != "/api/v2/checkout" {
		t.Fatalf("update failed: %v", updateRes)
	}

	// 6. Toggle status
	request("PUT", fmt.Sprintf("/api/v1/routes/%s/status", routeID), map[string]interface{}{
		"enabled": false,
	}, 200)

	statusCheck := request("GET", fmt.Sprintf("/api/v1/routes/%s", routeID), nil, 200)
	if statusCheck["enabled"] != false {
		t.Fatalf("expected enabled = false after toggle, got %v", statusCheck["enabled"])
	}

	// 7. Thử xóa upstream đang bị route tham chiếu -> Phải bị từ chối 400
	upstreamsList := request("GET", "/api/v1/upstreams?search=payment_cluster", nil, 200)
	items := upstreamsList["items"].([]interface{})
	var upstreamID float64
	for _, it := range items {
		m := it.(map[string]interface{})
		if m["name"] == "payment_cluster" {
			upstreamID = m["id"].(float64)
			break
		}
	}
	if upstreamID == 0 {
		t.Fatal("expected to find payment_cluster upstream ID")
	}

	request("DELETE", fmt.Sprintf("/api/v1/upstreams/%.0f", upstreamID), nil, 400)

	// 8. Xóa route
	request("DELETE", fmt.Sprintf("/api/v1/routes/%s", routeID), nil, 200)

	// 9. Xác nhận route đã bị xóa
	request("GET", fmt.Sprintf("/api/v1/routes/%s", routeID), nil, 404)

	// 10. Bây giờ xóa upstream phải thành công
	request("DELETE", fmt.Sprintf("/api/v1/upstreams/%.0f", upstreamID), nil, 200)
}
