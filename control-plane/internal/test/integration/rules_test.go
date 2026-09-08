package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/gin-gonic/gin"
)

// This fixture owns only the Rules management integration boundary.
func rulesFixture(t *testing.T) (*sql.DB, http.Handler) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "rules.db")
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
	app.RegisterRoutes(router, module, "rules-test-token-at-least-32-bytes")
	return pools.Writer, router
}

func TestRulesHTTPIsolationAndRevisions(t *testing.T) {
	db, mux := rulesFixture(t)
	request := func(method, path, key, body, auth, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Idempotency-Key", key)
		if auth != "" {
			r.Header.Set("Authorization", "Bearer "+auth)
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}
	token := "rules-test-token-at-least-32-bytes"
	body := `{"name":"Private path","description":"fixture","group":"endpoint","action":"block","severity":"high","score":5,"priority":10,"path":"/private","enabled":true}`
	if w := request("POST", "/api/v1/rules", "create-fixture-0001", body, "", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	if w := request("POST", "/api/v1/rules", "create-fixture-0001", body, token, "https://evil.example"); w.Code != 403 {
		t.Fatal(w.Code)
	}
	for i := 0; i < 2; i++ {
		w := request("POST", "/api/v1/rules", "create-fixture-0001", body, token, "")
		if w.Code != 201 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	changed := bytes.ReplaceAll([]byte(body), []byte("/private"), []byte("/changed"))
	if w := request("POST", "/api/v1/rules", "create-fixture-0001", string(changed), token, ""); w.Code != 409 {
		t.Fatal(w.Code, w.Body.String())
	}
	for _, bad := range []string{
		string(bytes.ReplaceAll([]byte(body), []byte(`"block"`), []byte(`"rate_limit"`))),
		string(bytes.ReplaceAll([]byte(body), []byte(`/private`), []byte(`/%70rivate`))),
		body + `{}`, body[:len(body)-1] + `,"operator":"regex"}`,
	} {
		w := request("POST", "/api/v1/rules", "invalid-fixture-01", bad, token, "")
		if w.Code != 400 && w.Code != 422 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	update := body[:len(body)-1] + `,"expected_version":1}`
	update = string(bytes.ReplaceAll([]byte(update), []byte(`"enabled":true`), []byte(`"enabled":false`)))
	if w := request("PUT", "/api/v1/rules/1", "", update, token, ""); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := request("PUT", "/api/v1/rules/1", "", update, token, ""); w.Code != 409 {
		t.Fatal(w.Code)
	}
	w := request("GET", "/api/v1/rules/1", "", "", token, "")
	var detail struct {
		Version int64 `json:"version"`
		Enabled bool  `json:"enabled"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil || detail.Version != 2 || detail.Enabled {
		t.Fatal(w.Body.String(), err)
	}
	w = request("GET", "/api/v1/rules?enabled=false&limit=1", "", "", token, "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"id":"1"`)) {
		t.Fatal(w.Body.String())
	}
	var count int
	w = request("GET", "/api/v1/rules/1/history?limit=1", "", "", token, "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"next_before":2`)) {
		t.Fatal(w.Code, w.Body.String())
	}
	w = request("GET", "/api/v1/rules/1/history?limit=1&before=2", "", "", token, "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"version":1`)) {
		t.Fatal(w.Code, w.Body.String())
	}
	if os.Getenv("AURORA_TEST_COMPILER") != "" {
		w = request("POST", "/api/v1/rule-releases", "http-publication-01", "", token, "")
		if w.Code != 201 {
			t.Fatal(w.Code, w.Body.String())
		}
		w = request("GET", "/api/v1/rule-releases/1", "", "", token, "")
		if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"state":"ready"`)) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if err := db.QueryRow("SELECT count(*) FROM rule_revisions").Scan(&count); err != nil || count != 2 {
		t.Fatal(count, err)
	}
	if _, err := db.Exec("UPDATE rule_revisions SET score=99"); err == nil {
		t.Fatal("revision was mutable")
	}
	if _, err := db.Exec("DELETE FROM rule_revisions"); err == nil {
		t.Fatal("revision was deletable")
	}
}

func TestConcurrentRuleUpdateHasOneWinner(t *testing.T) {
	db, _ := rulesFixture(t)
	ctx := context.Background()
	ruleSvc := service.NewRuleService(repository.NewRuleRepository(db, db), "")
	_, err := ruleSvc.Create(ctx, entity.CreateRuleCommand{RequestKey: "concurrent-create-01", Name: "one", Group: "custom", Action: "block", Severity: "low", Path: "/one", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := ruleSvc.Update(ctx, entity.UpdateRuleCommand{ID: 1, ExpectedVersion: 1, Name: "changed", Group: "custom", Action: "log", Severity: "low", Path: "/one"})
			results <- err
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else if err != taxonomy.ErrRuleConflict {
			t.Fatal(err)
		}
	}
	if wins != 1 {
		t.Fatal("winners", wins)
	}
}

func TestPublishFreezesRevisionsAndRecoversCompilerFailure(t *testing.T) {
	compiler := os.Getenv("AURORA_TEST_COMPILER")
	if compiler == "" {
		t.Skip("set AURORA_TEST_COMPILER to real aurora-compile binary")
	}
	db, _ := rulesFixture(t)
	ctx := context.Background()
	ruleSvc := service.NewRuleService(repository.NewRuleRepository(db, db), "")
	_, err := ruleSvc.Create(ctx, entity.CreateRuleCommand{RequestKey: "publish-fixture-01", Name: "one", Group: "custom", Action: "block", Severity: "low", Path: "/one", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	publishRepo := repository.NewRuleRepository(db, db)
	broken := service.NewRuleService(publishRepo, "/missing/aurora-compile")
	command := entity.PublishRulesCommand{RequestKey: "publish-release-01"}
	if _, err = broken.Publish(ctx, command); err != taxonomy.ErrPublishUnavailable {
		t.Fatal(err)
	}
	_, err = ruleSvc.Update(ctx, entity.UpdateRuleCommand{ID: 1, ExpectedVersion: 1, Name: "one", Group: "custom", Action: "block", Severity: "low", Path: "/one", Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	publish := service.NewRuleService(publishRepo, compiler)
	first, err := publish.Publish(ctx, command)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := publish.Publish(ctx, command)
	if err != nil || replay != first {
		t.Fatal(replay, err)
	}
	var payload []byte
	if err = db.QueryRow("SELECT payload FROM ruleset_releases WHERE id=?", first.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(payload, []byte(`/one`)) {
		t.Fatal("retry used latest mutation instead of frozen revision")
	}
	second, err := publish.Publish(ctx, entity.PublishRulesCommand{RequestKey: "publish-release-02"})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT payload FROM ruleset_releases WHERE id=?", second.ID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(payload, []byte(`"rules":[]`)) {
		t.Fatal(string(payload))
	}
	if _, err = db.Exec("UPDATE ruleset_releases SET payload=X'00' WHERE id=?", first.ID); err == nil {
		t.Fatal("release payload was mutable")
	}
}

func TestRuleEvaluationRejectsInvalidEnvelope(t *testing.T) {
	_, mux := rulesFixture(t)
	for _, tc := range []struct {
		name, path, body string
		status           int
	}{
		{"trailing JSON", "/api/v1/rules/test", `{"conditions":[{"field":"path","operator":"equals","value":"/"}]} {}`, 400},
		{"null", "/api/v1/rules/test", `null`, 422},
		{"empty draft", "/api/v1/rules/test", `{}`, 422},
		{"invalid body ID", "/api/v1/rules/test", `{"rule_id":0}`, 400},
		{"invalid route ID", "/api/v1/rules/nope/test", `{}`, 400},
		{"missing stored rule", "/api/v1/rules/999999/test", `{}`, 404},
		{"no invented client IP", "/api/v1/rules/test", `{"conditions":[{"field":"client_ip","operator":"equals","value":"192.0.2.1"}]}`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer rules-test-token-at-least-32-bytes")
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("got %d: %s", w.Code, w.Body.String())
			}
			if tc.status == 200 {
				var got struct {
					Matched bool `json:"matched"`
					Details []struct {
						Extracted string `json:"extracted_value"`
					} `json:"details"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
					t.Fatal(err)
				}
				if got.Matched || len(got.Details) != 1 || got.Details[0].Extracted != "" {
					t.Fatalf("test used connection IP instead of sample input: %s", w.Body.String())
				}
			}
		})
	}
}
