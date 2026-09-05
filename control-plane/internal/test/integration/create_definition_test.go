package integration_test

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/repository"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// Test fixture only: requests use the public transport and the same credential
// boundary as the embedded UI, never bypassing validation to test creation.
func createDefinitionRequest(mux http.Handler, body, key string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/api/v2/rules", bytes.NewBufferString(body))
	req.Header.Set("Authorization", "Bearer rules-test-token-at-least-32-bytes")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	result := httptest.NewRecorder()
	mux.ServeHTTP(result, req)
	return result
}

const definitionFixture = `{"name":"Header and query rule","description":"保存 definition","group":"sqli","severity":"high","score":7,"enabled":true,"priority":42,"policy_id":null ,"logic_mode":"any","conditions":[{"field":"header","operator":"equals","value":"test-agent","header_name":"User-Agent"},{"field":"query","operator":"regex","value":"(?i)union\\s+select","header_name":""}],"action":"block","response_code":429,"custom_response":"Not allowed","log_event":true,"add_to_reputation":true,"source_ip":"10.0.0.0/8, ::1","host_domain":"example.com","path_prefix":"/api","http_method":"POST"}`

func TestCreateDefinitionRoundTripAndPublicationBoundary(t *testing.T) {
	db, mux := rulesFixture(t)
	first := createDefinitionRequest(mux, definitionFixture, "definition-request-01")
	if first.Code != 201 {
		t.Fatal(first.Code, first.Body.String())
	}
	var saved struct {
		ID            int64    `json:"id,string"`
		Version       int64    `json:"version"`
		State         string   `json:"state"`
		RuntimeReady  bool     `json:"runtime_ready"`
		RuntimeIssues []string `json:"runtime_issues"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.ID != 1 || saved.Version != 1 || saved.State != "saved" || saved.RuntimeReady || len(saved.RuntimeIssues) == 0 {
		t.Fatal(saved)
	}
	if first.Header().Get("Location") != "/api/v1/rules/1" {
		t.Fatal(first.Header())
	}
	second := createDefinitionRequest(mux, definitionFixture, "definition-request-01")
	if second.Code != 201 || second.Body.String() != first.Body.String() {
		t.Fatal(second.Code, second.Body.String())
	}
	changed := bytes.ReplaceAll([]byte(definitionFixture), []byte("example.com"), []byte("other.example.com"))
	if result := createDefinitionRequest(mux, string(changed), "definition-request-01"); result.Code != 409 {
		t.Fatal(result.Code, result.Body.String())
	}
	detail, err := repository.NewRuleRepository(db, db).Detail(context.Background(), entity.RuleDetailQuery{ID: 1})
	if err != nil {
		t.Fatal(err)
	}
	if detail.LogicMode != "any" || len(detail.Conditions) != 2 || detail.Conditions[0].HeaderName != "User-Agent" || detail.Conditions[1].Value != "(?i)union\\s+select" || detail.SourceIP != "10.0.0.0/8, ::1" || detail.HostDomain != "example.com" || detail.PathPrefix != "/api" || detail.HTTPMethod != "POST" || detail.ResponseCode == nil || *detail.ResponseCode != 429 || detail.CustomResponse != "Not allowed" || !detail.LogEvent || !detail.AddToReputation || detail.RuntimeReady || detail.SchemaVersion != 2 {
		t.Fatalf("lost definition fields: %+v", detail)
	}
	if _, err = repository.NewRuleRepository(db, db).Reserve(context.Background(), entity.PublishRulesCommand{RequestKey: "must-not-publish-01"}); err != taxonomy.ErrRuleInvalid {
		t.Fatal("unsupported definition flattened", err)
	}
	var releases, activations int
	db.QueryRow("SELECT count(*) FROM ruleset_releases").Scan(&releases)
	db.QueryRow("SELECT count(*) FROM node_activation").Scan(&activations)
	if releases != 0 || activations != 0 {
		t.Fatal("create touched deployment", releases, activations)
	}
	for _, statement := range []string{"UPDATE rule_definitions SET conditions_json='[]'", "DELETE FROM rule_definitions"} {
		if _, err = db.Exec(statement); err == nil {
			t.Fatal("definition not immutable", statement)
		}
	}
	_, err = repository.NewRuleRepository(db, db).Update(context.Background(), entity.UpdateRuleCommand{ID: 1, ExpectedVersion: 1, Name: "lost", Group: "custom", Action: "allow", Severity: "low", Path: "/"})
	if err != taxonomy.ErrRuleConflict {
		t.Fatal("legacy edit could erase definition", err)
	}
}

func TestCreateDefinitionValidationAndAtomicRollback(t *testing.T) {
	db, mux := rulesFixture(t)
	var original map[string]any
	if err := json.Unmarshal([]byte(definitionFixture), &original); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		field string
		value any
	}{
		{"logic_mode", "xor"}, {"action", "challenge"}, {"policy_id", "mock-policy"}, {"source_ip", "not-an-ip"}, {"host_domain", "https://example.com"}, {"priority", -1}, {"score", 1001}, {"conditions", []any{}},
		{"path_prefix", "/bad\tpath"}, {"conditions", make([]any, 17)},
		{"conditions", []any{map[string]any{"field": "query", "operator": "regex", "value": "[", "header_name": ""}}},
		{"conditions", []any{map[string]any{"field": "header", "operator": "equals", "value": "x", "header_name": "Bad\r\nHeader"}}},
	} {
		var copy map[string]any
		json.Unmarshal([]byte(definitionFixture), &copy)
		copy[tc.field] = tc.value
		raw, _ := json.Marshal(copy)
		result := createDefinitionRequest(mux, string(raw), "invalid-definition-01")
		if result.Code != 422 || !bytes.Contains(result.Body.Bytes(), []byte(`"fields"`)) {
			t.Fatal(tc.field, result.Code, result.Body.String())
		}
	}
	if result := createDefinitionRequest(mux, definitionFixture+"{}", "invalid-definition-02"); result.Code != 400 {
		t.Fatal(result.Code)
	}
	var count int
	db.QueryRow("SELECT count(*) FROM rules").Scan(&count)
	if count != 0 {
		t.Fatal("validation left rules", count)
	}
	if _, err := db.Exec(`CREATE TRIGGER fail_definition BEFORE INSERT ON rule_definitions BEGIN SELECT RAISE(ABORT,'failure injection'); END`); err != nil {
		t.Fatal(err)
	}
	if result := createDefinitionRequest(mux, definitionFixture, "retry-after-storage-01"); result.Code != 500 {
		t.Fatal(result.Code)
	}
	for _, table := range []string{"rules", "rule_revisions", "rule_definitions", "definition_creates"} {
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
	if _, err := db.Exec("DROP TRIGGER fail_definition"); err != nil {
		t.Fatal(err)
	}
	if result := createDefinitionRequest(mux, definitionFixture, "retry-after-storage-01"); result.Code != 201 {
		t.Fatal(result.Code, result.Body.String())
	}
}

func TestCreateDefinitionConcurrentReplay(t *testing.T) {
	db, mux := rulesFixture(t)
	var wg sync.WaitGroup
	results := make(chan *httptest.ResponseRecorder, 20)
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- createDefinitionRequest(mux, definitionFixture, "concurrent-definition-01")
		}()
	}
	wg.Wait()
	close(results)
	var first any
	for result := range results {
		if result.Code != 201 {
			t.Fatal(result.Code, result.Body.String())
		}
		var value any
		json.Unmarshal(result.Body.Bytes(), &value)
		if first == nil {
			first = value
		} else if !reflect.DeepEqual(first, value) {
			t.Fatal("retry changed result")
		}
	}
	for _, table := range []string{"rules", "rule_revisions", "rule_definitions", "definition_creates"} {
		var count int
		if err := db.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatal(table, count, err)
		}
	}
}

func TestCreateDefinitionExactSubsetStillCompiles(t *testing.T) {
	db, mux := rulesFixture(t)
	const body = `{"name":"Exact","group":"custom","severity":"low","score":0,"enabled":true,"priority":0,"logic_mode":"all","conditions":[{"field":"path","operator":"equals","value":"/private","header_name":""}],"action":"block","response_code":403}`
	response := createDefinitionRequest(mux, body, "exact-definition-0001")
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	var result struct {
		RuntimeReady bool `json:"runtime_ready"`
	}
	json.Unmarshal(response.Body.Bytes(), &result)
	if !result.RuntimeReady {
		t.Fatal(result)
	}
	release, err := repository.NewRuleRepository(db, db).Reserve(context.Background(), entity.PublishRulesCommand{RequestKey: "exact-definition-release"})
	if err != nil || !bytes.Contains(release.Payload, []byte(`"path":"/private"`)) {
		t.Fatal(string(release.Payload), err)
	}
	if os.Getenv("AURORA_TEST_COMPILER") != "" {
		req := httptest.NewRequest("POST", "/api/v1/rule-releases", nil)
		req.Header.Set("Authorization", "Bearer rules-test-token-at-least-32-bytes")
		req.Header.Set("Idempotency-Key", "exact-definition-release")
		result := httptest.NewRecorder()
		mux.ServeHTTP(result, req)
		if result.Code != 201 && result.Code != 200 {
			t.Fatal("real compiler rejected supported definition", result.Code, result.Body.String())
		}
	}
}

func TestCreateDefinitionTransportBoundary(t *testing.T) {
	db, mux := rulesFixture(t)
	for _, tc := range []struct {
		name, body, token, origin, media string
		status                           int
	}{
		{"anonymous", definitionFixture, "", "", "application/json", 401},
		{"cross origin", definitionFixture, "rules-test-token-at-least-32-bytes", "https://attacker.invalid", "application/json", 403},
		{"unknown field", `{"surprise":true}`, "rules-test-token-at-least-32-bytes", "", "application/json", 400},
		{"oversize", strings.Repeat("x", 65537), "rules-test-token-at-least-32-bytes", "", "application/json", 413},
		{"media", definitionFixture, "rules-test-token-at-least-32-bytes", "", "text/plain", 415},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v2/rules", strings.NewReader(tc.body))
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			req.Header.Set("Origin", tc.origin)
			req.Header.Set("Content-Type", tc.media)
			req.Header.Set("Idempotency-Key", "transport-definition-key")
			result := httptest.NewRecorder()
			mux.ServeHTTP(result, req)
			if result.Code != tc.status {
				t.Fatal(result.Code, result.Body.String())
			}
		})
	}
	var count int
	if err := db.QueryRow("SELECT count(*) FROM rules").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
}
