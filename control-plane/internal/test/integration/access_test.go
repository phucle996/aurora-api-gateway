package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestAccessPublicationAuthorityReplayAndRecovery(t *testing.T) {
	compiler := os.Getenv("AURORA_TEST_COMPILER")
	if compiler == "" {
		t.Skip("requires real compiler")
	}
	path := filepath.Join(t.TempDir(), "access.db")
	a, e := app.NewApp(context.Background(), config.Config{SQLitePath: path})
	if e != nil {
		t.Fatal(e)
	}
	a.Close()
	pools, e := infra.OpenSQLitePool(context.Background(), path)
	if e != nil {
		t.Fatal(e)
	}
	defer pools.Close()
	m := app.NewModule(pools.Writer, pools.Reader, config.Config{CompilerPath: compiler})
	defer m.MetricsService.Close()
	router := gin.New()
	app.RegisterRoutes(router, m, "access-test-token")
	request := func(method, url, key string, body any, token, origin string) *httptest.ResponseRecorder {
		b, _ := json.Marshal(body)
		q := httptest.NewRequest(method, url, bytes.NewReader(b))
		q.Header.Set("Content-Type", "application/json")
		q.Header.Set("Idempotency-Key", key)
		if token != "" {
			q.Header.Set("Authorization", "Bearer "+token)
		}
		if origin != "" {
			q.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, q)
		return w
	}
	rule := map[string]any{"name": "Protected network", "description": "test", "action": "block", "enabled": true, "priority": 10, "source": "cidr", "values": []string{"192.0.2.45/24"}, "host": "*", "path_prefix": "/", "method": "*", "schedule": "always", "expires_at": 0, "log": true, "reputation": true, "alert": true}
	cmd := map[string]any{"id": 0, "kind": "rule", "expected_version": 0, "expected_release": 0, "delete": false, "document": rule}
	for _, check := range []struct {
		token, origin string
		status        int
	}{{"", "", 401}, {"access-test-token", "https://evil.test", 403}} {
		if w := request("POST", "/api/v1/access/changes", "create-access", cmd, check.token, check.origin); w.Code != check.status {
			t.Fatal(w.Code, w.Body)
		}
	}
	first := request("POST", "/api/v1/access/changes", "create-access", cmd, "access-test-token", "")
	if first.Code != 200 {
		t.Fatal(first.Code, first.Body)
	}
	replay := request("POST", "/api/v1/access/changes", "create-access", cmd, "access-test-token", "")
	if replay.Code != 200 || !bytes.Equal(first.Body.Bytes(), replay.Body.Bytes()) {
		t.Fatal("replay", replay.Code, replay.Body)
	}
	rule["name"] = "changed"
	if w := request("POST", "/api/v1/access/changes", "create-access", cmd, "access-test-token", ""); w.Code != 409 {
		t.Fatal("key reuse", w.Code, w.Body)
	}
	cmd["id"] = 1
	cmd["expected_version"] = 1
	cmd["expected_release"] = 1
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes <- request("POST", "/api/v1/access/changes", fmt.Sprintf("concurrent-%d", i), cmd, "access-test-token", "").Code
		}(i)
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatal(counts)
	}
	// Invalid runtime input cannot leave a changed object or a durable head.
	rule["path_prefix"] = "/../bad"
	cmd["expected_version"] = 2
	cmd["expected_release"] = 2
	if w := request("POST", "/api/v1/access/changes", "invalid-path", cmd, "access-test-token", ""); w.Code != 422 {
		t.Fatal(w.Code, w.Body)
	}
	rule["path_prefix"] = "/"
	rule["source"] = "country"
	rule["values"] = []string{"VN"}
	if w := request("POST", "/api/v1/access/changes", "missing-geo", cmd, "access-test-token", ""); w.Code != 422 {
		t.Fatal(w.Code, w.Body)
	}
	var version, head int
	_ = pools.Reader.QueryRow(`SELECT version FROM access_objects WHERE id=1`).Scan(&version)
	_ = pools.Reader.QueryRow(`SELECT release_id FROM access_head`).Scan(&head)
	if version != 2 || head != 2 {
		t.Fatal(version, head)
	}
	dataset := map[string]any{"id": 0, "kind": "dataset", "expected_version": 0, "expected_release": 2, "delete": false, "document": map[string]any{"name": "owned fixture", "networks": []any{map[string]string{"cidr": "198.51.100.0/24", "country": "VN", "asn": "AS64500"}}}}
	if w := request("POST", "/api/v1/access/changes", "import-geo", dataset, "access-test-token", ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	cmd["expected_release"] = 3
	if w := request("POST", "/api/v1/access/changes", "enable-geo", cmd, "access-test-token", ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	sync := request("GET", "/api/v1/access-sync/node-local-01", "", nil, "access-test-token", "")
	if sync.Code != 200 || !bytes.Contains(sync.Body.Bytes(), []byte("198.51.100.0/24")) {
		t.Fatal(sync.Code, sync.Body)
	}
	// Deleting a referenced dataset rolls back atomically.
	dataset["id"] = 2
	dataset["expected_version"] = 1
	dataset["expected_release"] = 4
	dataset["delete"] = true
	if w := request("POST", "/api/v1/access/changes", "delete-geo", dataset, "access-test-token", ""); w.Code != 422 {
		t.Fatal(w.Code, w.Body)
	}
	for _, phase := range []string{"validated", "reload_requested", "failed", "validated", "reload_requested", "observed"} {
		if w := request("POST", "/api/v1/access-sync/node-local-01", "", map[string]any{"release_id": 4, "phase": phase, "message": "test"}, "access-test-token", ""); w.Code != 204 {
			t.Fatal(w.Code, w.Body)
		}
	}
	if w := request("POST", "/api/v1/access-sync/node-local-01", "", map[string]any{"release_id": 4, "phase": "failed", "message": "late"}, "access-test-token", ""); w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	if w := request("GET", "/api/v1/access-sync/unknown", "", nil, "access-test-token", ""); w.Code != 404 {
		t.Fatal(w.Code, w.Body)
	}
	event := map[string]any{"key": "event-replay-1", "release_id": 1, "rule_id": 1, "ip": "192.0.2.4"}
	for i := 0; i < 2; i++ {
		if w := request("POST", "/api/v1/access-sync/node-local-01/matches", "", event, "access-test-token", ""); w.Code != 204 {
			t.Fatal(w.Code, w.Body)
		}
	}
	var count int
	_ = pools.Reader.QueryRow(`SELECT count(*) FROM access_events WHERE alert=1 AND reputation=1`).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate event", count)
	}
	event["ip"] = "192.0.2.5"
	if w := request("POST", "/api/v1/access-sync/node-local-01/matches", "", event, "access-test-token", ""); w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	if _, e = pools.Writer.Exec(`UPDATE access_releases SET digest='tampered'`); e == nil {
		t.Fatal("mutable release")
	}
	// A new application instance reads the same release and revision history.
	reopened, e := app.NewApp(context.Background(), config.Config{SQLitePath: path})
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	history := request("GET", "/api/v1/access?id=1&history=true", "", nil, "access-test-token", "")
	if history.Code != 200 {
		t.Fatal(history.Code, history.Body)
	}
	var rows []any
	if json.Unmarshal(history.Body.Bytes(), &rows) != nil || len(rows) != 3 {
		t.Fatal(history.Body)
	}
}
