package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

func TestModulesQueueReportReplayAndAuthority(t *testing.T) {
	h := upstreamsFixture(t)
	call := func(method, path string, body any, want int) []byte {
		t.Helper()
		data, _ := json.Marshal(body)
		r := httptest.NewRequest(method, path, bytes.NewReader(data))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer upstreams-test-token-at-least-32-bytes")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}
	jobs := "/api/v1/settings/modules/node-local-01/jobs"
	report := "/api/v1/module-sync/node-local-01/report"
	poll := "/api/v1/module-sync/node-local-01/poll"
	call("POST", jobs, map[string]any{"action": "install_brotli"}, 422)
	call("POST", jobs, map[string]any{"action": "shell;curl example.com"}, 422)
	now := time.Now().UnixMilli()
	modules := []map[string]any{{"name": "gzip", "available": true, "loaded": true, "source": "runtime response check"}, {"name": "brotli", "available": false, "loaded": false, "source": "runtime response check"}}
	body := map[string]any{"checked_at": now, "nginx_version": "1.30.4", "architecture": "x86_64", "modules": modules, "installable": true}
	call("POST", "/api/v1/module-sync/unknown/report", body, 422)
	call("POST", report, body, 204)
	var first, duplicate struct{ ID int64 }
	json.Unmarshal(call("POST", jobs, map[string]any{"action": "install_brotli"}, 202), &first)
	json.Unmarshal(call("POST", jobs, map[string]any{"action": "install_brotli"}, 202), &duplicate)
	if first.ID == 0 || first.ID != duplicate.ID {
		t.Fatal("duplicate install was not coalesced")
	}
	var claimed struct {
		ID     int64
		Action string
	}
	json.Unmarshal(call("POST", poll, nil, 200), &claimed)
	if claimed.ID != first.ID || claimed.Action != "install_brotli" {
		t.Fatal("wrong job claimed")
	}
	body["job_id"] = first.ID
	body["job_state"] = "succeeded"
	call("POST", report, body, 422) // Installation cannot succeed without observed Brotli.
	modules[1]["available"] = true
	modules[1]["loaded"] = true
	body["job_logs"] = "Brotli compilation succeeded. NGINX reloaded ok."
	call("POST", report, body, 204)
	call("POST", report, body, 204) // Lost response/replay is idempotent.
	body["job_state"] = "failed"
	call("POST", report, body, 422)
	body["job_state"] = "succeeded"
	body["checked_at"] = now - 1
	call("POST", report, body, 422)
	var list []struct {
		NodeID   string `json:"node_id"`
		Fresh    bool
		JobState string `json:"job_state"`
		JobLogs  string `json:"job_logs"`
	}
	json.Unmarshal(call("GET", "/api/v1/settings/modules", nil, 200), &list)
	if len(list) != 1 || !list[0].Fresh || list[0].JobState != "succeeded" || list[0].JobLogs != "Brotli compilation succeeded. NGINX reloaded ok." {
		t.Fatalf("invalid observed module projection: %+v", list)
	}

	// Verify legacy route alias works
	var legacyList []struct {
		NodeID   string `json:"node_id"`
		Fresh    bool
		JobState string `json:"job_state"`
	}
	json.Unmarshal(call("GET", "/api/v1/settings/dependencies", nil, 200), &legacyList)
	if len(legacyList) != 1 || legacyList[0].JobState != "succeeded" {
		t.Fatalf("legacy route alias failed: %+v", legacyList)
	}

	// Verify logs endpoint
	var logsResp struct {
		ID     int64  `json:"id"`
		NodeID string `json:"node_id"`
		Logs   string `json:"logs"`
		State  string `json:"state"`
	}
	json.Unmarshal(call("GET", fmt.Sprintf("/api/v1/settings/modules/jobs/%d/logs", first.ID), nil, 200), &logsResp)
	if logsResp.ID != first.ID || logsResp.Logs != "Brotli compilation succeeded. NGINX reloaded ok." || logsResp.State != "succeeded" {
		t.Fatalf("job logs endpoint failed: %+v", logsResp)
	}

	for _, path := range []string{poll, report} {
		r := httptest.NewRequest("POST", path+"?token=upstreams-test-token-at-least-32-bytes", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("query token accepted for node mutation", w.Code)
		}
	}
	body["job_id"] = first.ID + 100
	body["checked_at"] = time.Now().UnixMilli()
	call("POST", report, body, 422)
	stale := map[string]any{"checked_at": time.Now().UnixMilli() - 95000, "nginx_version": "1.30.4", "modules": modules, "installable": true}
	call("POST", report, stale, 422)
	call("POST", fmt.Sprintf("/api/v1/settings/modules/%s/jobs", "unknown"), map[string]any{"action": "check"}, 422)
}
