package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
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
	t.Cleanup(func() { _ = m.AnalyticsService.Close(); _ = pools.Close() })
	r := gin.New()
	app.RegisterRoutes(r, m, "policy-test-token")
	_, err = pools.Writer.Exec(`INSERT INTO rules(id,version,name,description,rule_group,action,severity,score,priority,path,enabled) VALUES(1,1,'Protected','fixture','endpoint','block','high',5,10,'/private',1);
 INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'fixture' FROM rules;
 INSERT INTO cluster_nodes (id, name, hostname, ip, role, status, version, sync_status, join_method, certificate) VALUES ('node-local-01', 'node-local-01', '', '127.0.0.1', 'Edge Node', 'Ready', '0.4.1', 'In Sync', 'Unknown', 'Unknown');`)
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

	catalogReq := request("GET", "/api/v1/policies/catalog", "", "", "policy-test-token", "")
	if catalogReq.Code != 200 {
		t.Fatal(catalogReq.Code, catalogReq.Body)
	}
	var catalogItems []entity.PolicyCatalogItem
	if err := json.Unmarshal(catalogReq.Body.Bytes(), &catalogItems); err != nil {
		t.Fatal(err)
	}
	if len(catalogItems) != 1 || catalogItems[0].ID != 1 || catalogItems[0].Name != "Cluster web" {
		t.Fatalf("unexpected catalog items: %+v", catalogItems)
	}

	ruleCatalogReq := request("GET", "/api/v1/policies/rule-catalog", "", "", "policy-test-token", "")
	if ruleCatalogReq.Code != 200 {
		t.Fatal(ruleCatalogReq.Code, ruleCatalogReq.Body)
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

func TestPolicyDraftWithoutPathPrefix(t *testing.T) {
	_, router := policyFixture(t)
	request := func(method, path, key, body, token string) *httptest.ResponseRecorder {
		q := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		q.Header.Set("Content-Type", "application/json")
		q.Header.Set("Idempotency-Key", key)
		if token != "" {
			q.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, q)
		return w
	}
	noPrefixBody := `{"name":"Policy Without Prefix","description":"test","host":"api.test","mode":"mixed","priority":50,"rule_ids":[1],"expected_version":0}`
	w := request("POST", "/api/v1/policies", "create-no-prefix-01", noPrefixBody, "policy-test-token")
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body)
	}
	w = request("GET", "/api/v1/policies", "", "", "policy-test-token")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("Policy Without Prefix")) {
		t.Fatal(w.Code, w.Body)
	}
}

func TestPolicyClusterFreshHeartbeatConfirmsStableRelease(t *testing.T) {
	db, router := policyFixture(t)
	_, err := db.Exec(`INSERT INTO policy_cluster_releases(id,digest,payload,membership,actor) VALUES(100,'digest','{}','[]','test');
 INSERT INTO policy_cluster_head(singleton,release_id) VALUES(1,100);
 INSERT INTO cluster_nodes(id,name,hostname,ip,observed_release_id,last_heartbeat) VALUES('fresh','fresh','fresh','127.0.0.1',100,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT INTO policy_node_reports(node_id,release_id,phase,message,updated_at) VALUES('fresh',100,'observed','applied',strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes'));`)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ name, sql, want string }{
		{"fresh same generation", "SELECT 1", "observed"},
		{"fresh different generation", "UPDATE cluster_nodes SET observed_release_id=99 WHERE id='fresh'", "stale"},
		{"old heartbeat", "UPDATE cluster_nodes SET observed_release_id=100,last_heartbeat=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 minutes') WHERE id='fresh'", "stale"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := db.Exec(tc.sql); err != nil {
				t.Fatal(err)
			}
			q := httptest.NewRequest("GET", "/api/v1/policies/cluster", nil)
			q.Header.Set("Authorization", "Bearer policy-test-token")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, q)
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body)
			}
			var got struct{ Nodes []struct{ ID, Phase string } }
			if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, n := range got.Nodes {
				if n.ID == "fresh" {
					found = true
					if n.Phase != tc.want {
						t.Fatalf("got %s want %s", n.Phase, tc.want)
					}
				}
			}
			if !found {
				t.Fatal("missing node")
			}
		})
	}
}
