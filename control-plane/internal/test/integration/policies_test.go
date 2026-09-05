package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// Private fixture owns policies and real SQLite; it does not call a rules read
// workflow to establish publication authority.
func policyFixture(t *testing.T) (*sql.DB, http.Handler) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "policies.db")
	a, err := app.NewApp(context.Background(), config.Config{SQLitePath: path})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Close(); err != nil {
		t.Fatal(err)
	}
	pools, err := infra.OpenSQLitePool(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	m := app.NewModule(pools.Writer, pools.Reader, config.Config{CompilerPath: os.Getenv("AURORA_TEST_COMPILER")})
	t.Cleanup(func() { _ = m.MetricsService.Close(); _ = pools.Close() })
	r := gin.New()
	app.RegisterRoutes(r, m, "policy-test-token")
	_, err = pools.Writer.Exec(`INSERT INTO rules(id,version,name,description,rule_group,action,severity,score,priority,path,enabled) VALUES(1,1,'Protected','fixture','endpoint','block','high',5,10,'/private',1);
 INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'fixture' FROM rules`)
	if err != nil {
		t.Fatal(err)
	}
	return pools.Writer, r
}

func TestPolicyDraftHTTPAndConcurrentRevision(t *testing.T) {
	db, router := policyFixture(t)
	request := func(method, path, key, body, token, origin string) *httptest.ResponseRecorder {
		q := httptest.NewRequest(method, path, bytes.NewBufferString(body))
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
	body := `{"name":"Cluster web","description":"test","host":"*","path_prefix":"/","mode":"mixed","priority":100,"rule_ids":[1],"expected_version":0}`
	if w := request("POST", "/api/v1/policies", "create-0001", body, "", ""); w.Code != 401 {
		t.Fatal(w.Code, w.Body)
	}
	if w := request("POST", "/api/v1/policies", "create-0001", body, "policy-test-token", "https://evil.test"); w.Code != 403 {
		t.Fatal(w.Code, w.Body)
	}
	for i := 0; i < 2; i++ {
		if w := request("POST", "/api/v1/policies", "create-0001", body, "policy-test-token", ""); w.Code != 200 {
			t.Fatal(w.Code, w.Body)
		}
	}
	if w := request("POST", "/api/v1/policies", "create-0001", string(bytes.ReplaceAll([]byte(body), []byte("Cluster web"), []byte("Changed"))), "policy-test-token", ""); w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
	for _, bad := range []string{body + `{}`, body[:len(body)-1] + `,"published_version":1}`, string(bytes.ReplaceAll([]byte(body), []byte(`"mixed"`), []byte(`"challenge"`))), string(bytes.ReplaceAll([]byte(body), []byte(`"/"`), []byte(`"/../"`))), string(bytes.ReplaceAll([]byte(body), []byte(`[1]`), []byte(`[1,1]`))), string(bytes.ReplaceAll([]byte(body), []byte(`[1]`), []byte(`[999]`)))} {
		w := request("POST", "/api/v1/policies", "invalid-0001", bad, "policy-test-token", "")
		if w.Code != 400 && w.Code != 422 {
			t.Fatal(w.Code, w.Body)
		}
	}
	update := string(bytes.ReplaceAll([]byte(body), []byte(`"expected_version":0`), []byte(`"expected_version":1`)))
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes <- request("PUT", "/api/v1/policies/1", fmt.Sprintf("edit-%08d", i), update, "policy-test-token", "").Code
		}(i)
	}
	wg.Wait()
	close(codes)
	wins, conflicts := 0, 0
	for c := range codes {
		if c == 200 {
			wins++
		}
		if c == 409 {
			conflicts++
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatal(wins, conflicts)
	}
	if _, err := db.Exec(`UPDATE policy_revisions SET document='{}' WHERE policy_id=1`); err == nil {
		t.Fatal("immutable revision changed")
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM policy_revisions`).Scan(&n); err != nil || n != 2 {
		t.Fatal(n, err)
	}
	w := request("PUT", "/api/v1/policies/1", "restore-0001", `{"expected_version":2,"restore_version":1}`, "policy-test-token", "")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	w = request("GET", "/api/v1/policies/1?history=true", "", "", "policy-test-token", "")
	var history []map[string]any
	if json.Unmarshal(w.Body.Bytes(), &history) != nil || len(history) != 3 {
		t.Fatal(w.Body)
	}
}

func TestPolicyPublicationPinnedSnapshotAndSettlement(t *testing.T) {
	if os.Getenv("AURORA_TEST_COMPILER") == "" {
		t.Skip("set AURORA_TEST_COMPILER to the real Rust compiler")
	}
	db, router := policyFixture(t)
	req := func(method, path, key, body string) *httptest.ResponseRecorder {
		q := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		q.Header.Set("Authorization", "Bearer policy-test-token")
		q.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, q)
		return w
	}
	body := `{"name":"Cluster web","host":"*","path_prefix":"/","mode":"mixed","priority":100,"rule_ids":[1],"expected_version":0}`
	if w := req("POST", "/api/v1/policies", "create-0001", body); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	publication := `{"expected_version":1,"expected_release":0,"disable":false}`
	if w := req("POST", "/api/v1/policies/1/publish?preview=true", "", publication); w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var n int
	_ = db.QueryRow(`SELECT count(*) FROM policy_cluster_head`).Scan(&n)
	if n != 0 {
		t.Fatal("preview changed head")
	}
	// Rule changes after draft capture must not silently change this policy.
	if _, err := db.Exec(`UPDATE rules SET action='allow' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	w := req("POST", "/api/v1/policies/1/publish", "publish-0001", publication)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	var release struct {
		ReleaseID int64           `json:"release_id"`
		Payload   json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &release); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(release.Payload, []byte(`"action":"block"`)) {
		t.Fatal(string(release.Payload))
	}
	replay := req("POST", "/api/v1/policies/1/publish", "publish-0001", publication)
	if replay.Code != 200 || !bytes.Equal(replay.Body.Bytes(), w.Body.Bytes()) {
		t.Fatal(replay.Code, replay.Body)
	}
	if stale := req("POST", "/api/v1/policies/1/publish", "publish-0002", publication); stale.Code != 409 {
		t.Fatal(stale.Code, stale.Body)
	}
	if _, err := db.Exec(`UPDATE policy_cluster_releases SET payload='{}'`); err == nil {
		t.Fatal("release mutable")
	}
	for _, phase := range []string{"validated", "reload_requested", "observed"} {
		w = req("POST", "/api/v1/policy-sync/node-local-01", "", fmt.Sprintf(`{"release_id":%d,"phase":%q,"message":"fixture"}`, release.ReleaseID, phase))
		if w.Code != 204 {
			t.Fatal(w.Code, w.Body)
		}
	}
	w = req("POST", "/api/v1/policy-sync/node-local-01", "", fmt.Sprintf(`{"release_id":%d,"phase":"failed","message":"stale failure"}`, release.ReleaseID))
	if w.Code != 409 {
		t.Fatal("stale phase overwritten", w.Code)
	}
	w = req("POST", "/api/v1/policies/1/publish", "disable-0001", fmt.Sprintf(`{"expected_version":1,"expected_release":%d,"disable":true}`, release.ReleaseID))
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	if !bytes.Contains(w.Body.Bytes(), []byte(`"policies":[]`)) {
		t.Fatal(w.Body)
	}
	w = req("POST", "/api/v1/policy-sync/node-local-01", "", fmt.Sprintf(`{"release_id":%d,"phase":"observed","message":"late"}`, release.ReleaseID))
	if w.Code != 409 {
		t.Fatal(w.Code, w.Body)
	}
}
