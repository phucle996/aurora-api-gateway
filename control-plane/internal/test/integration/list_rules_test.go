package integration_test

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

func TestListRulesFiltersCountsAndCursor(t *testing.T) {
	db, mux := rulesFixture(t)
	ruleSvc := service.NewRuleService(repository.NewRuleRepository(db, db), "")
	for i := 0; i < 55; i++ {
		action, group, enabled := "block", "custom", true
		if i%2 == 0 {
			action, group, enabled = "log", "sqli", false
		}
		_, err := ruleSvc.Create(context.Background(), entity.CreateRuleCommand{RequestKey: fmt.Sprintf("list-fixture-%08d", i), Name: fmt.Sprintf("Real rule %02d", i), Group: group, Action: action, Severity: "high", Path: "/real", Enabled: enabled})
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		query         string
		total, length int
		next          string
	}{
		{"limit=50", 55, 50, "50"}, {"limit=50&after=50", 55, 5, ""}, {"after=999", 55, 0, ""},
		{"group=sqli", 28, 28, ""}, {"action=block&enabled=true&severity=high", 27, 27, ""},
		{"search=REAL%20RULE%200&limit=3", 10, 3, "3"}, {"search=%25", 0, 0, ""},
		{"group=sqli&enabled=true", 0, 0, ""},
	} {
		req := httptest.NewRequest("GET", "/api/v1/rules?"+tc.query, nil)
		req.Header.Set("Authorization", "Bearer rules-test-token-at-least-32-bytes")
		out := httptest.NewRecorder()
		mux.ServeHTTP(out, req)
		var result entity.ListRulesResult
		if out.Code != 200 {
			t.Fatal(tc.query, out.Code, out.Body.String())
		}
		if err := json.Unmarshal(out.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Total != tc.total || len(result.Items) != tc.length || result.NextAfter != tc.next {
			t.Fatalf("%s: %+v", tc.query, result)
		}
		if result.Items == nil {
			t.Fatal("empty items must be [] not null")
		}
		for i := 1; i < len(result.Items); i++ {
			if result.Items[i].ID <= result.Items[i-1].ID {
				t.Fatal("unstable order")
			}
		}
	}
	for _, query := range []string{"action=fake", "group=fake", "severity=fake", "enabled=yes", "limit=101", "after=-1"} {
		req := httptest.NewRequest("GET", "/api/v1/rules?"+query, nil)
		req.Header.Set("Authorization", "Bearer rules-test-token-at-least-32-bytes")
		out := httptest.NewRecorder()
		mux.ServeHTTP(out, req)
		if out.Code != 422 {
			t.Fatal(query, out.Code)
		}
	}
	for _, path := range []string{"/api/v1/rules", "/api/v1/rules/stats"} {
		for _, tc := range []struct {
			token, origin string
			status        int
		}{{"", "", 401}, {"rules-test-token-at-least-32-bytes", "https://attacker.invalid", 403}} {
			req := httptest.NewRequest("GET", path, nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			req.Header.Set("Origin", tc.origin)
			out := httptest.NewRecorder()
			mux.ServeHTTP(out, req)
			if out.Code != tc.status || out.Header().Get("Cache-Control") != "no-store" {
				t.Fatal(path, out.Code, out.Header())
			}
		}
	}
}

func TestRuleStatsHistoricalStateAndCoverage(t *testing.T) {
	db, _ := rulesFixture(t)
	// Historical database fixture: explicit timestamps at insertion, never modify
	// immutable revisions or pretend a new installation has last-month history.
	_, err := db.Exec(`UPDATE schema_migrations SET applied_at='2023-12-01 00:00:00' WHERE version=2;
 INSERT INTO rules(id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at) VALUES
 (1,2,'one','','custom','log','low',0,0,'/one',1,'2024-03-01T00:00:00Z'),
 (2,2,'two','','custom','block','low',0,0,'/two',0,'2024-03-02T00:00:00Z'),
 (3,1,'three','','custom','block','low',0,0,'/three',1,'2024-03-01T00:00:00Z');
 INSERT INTO rule_revisions SELECT id,version,name,description,rule_group,action,severity,score,priority,path,enabled,updated_at,'fixture' FROM rules;
 INSERT INTO rule_revisions VALUES
 (1,1,'one','','custom','log','low',0,0,'/one',1,'2024-02-29T23:59:59.999Z','fixture'),
 (2,1,'two','','custom','log','low',0,0,'/two',1,'2024-01-31T10:00:00Z','fixture');`)
	if err != nil {
		t.Fatal(err)
	}
	r := repository.NewRuleRepository(db, db)
	result, err := r.Stats(context.Background(), entity.RuleStatsQuery{AsOf: time.Date(2024, 3, 15, 12, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 || result.Enabled != 2 || result.Log != 1 || result.Block != 1 || !result.HistoryAvailable || result.ComparisonBefore != "2024-03-01T00:00:00Z" {
		t.Fatal(result)
	}
	for label, pair := range map[string]struct {
		actual *int
		want   int
	}{"total": {result.TotalDelta, 1}, "enabled": {result.EnabledDelta, 0}, "log": {result.LogDelta, -1}, "block": {result.BlockDelta, 1}} {
		if pair.actual == nil || *pair.actual != pair.want {
			t.Fatal(label, pair)
		}
	}
	// Unknown coverage yields null, never a fabricated +3 against an assumed zero.
	if _, err = db.Exec("UPDATE schema_migrations SET applied_at='2024-03-05' WHERE version=2"); err != nil {
		t.Fatal(err)
	}
	result, err = r.Stats(context.Background(), entity.RuleStatsQuery{AsOf: time.Date(2024, 3, 15, 0, 0, 0, 0, time.UTC)})
	if err != nil || result.HistoryAvailable || result.TotalDelta != nil || result.EnabledDelta != nil || result.LogDelta != nil || result.BlockDelta != nil {
		t.Fatal(result, err)
	}
}

func TestRuleStatsEmptyAndYearBoundary(t *testing.T) {
	db, _ := rulesFixture(t)
	if _, err := db.Exec("UPDATE schema_migrations SET applied_at='2023-12-01' WHERE version=2"); err != nil {
		t.Fatal(err)
	}
	result, err := repository.NewRuleRepository(db, db).Stats(context.Background(), entity.RuleStatsQuery{AsOf: time.Date(2024, 1, 5, 0, 0, 0, 0, time.UTC)})
	if err != nil || result.ComparisonBefore != "2024-01-01T00:00:00Z" || result.Total != 0 || result.TotalDelta == nil || *result.TotalDelta != 0 {
		t.Fatal(result, err)
	}
}
