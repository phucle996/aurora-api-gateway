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

	// Verify SSE event stream endpoint returns initial job state
	sseReq := httptest.NewRequest("GET", fmt.Sprintf("/api/v1/settings/modules/jobs/%d/events", first.ID), nil)
	sseReq.Header.Set("Authorization", "Bearer upstreams-test-token-at-least-32-bytes")
	sseRec := httptest.NewRecorder()
	h.ServeHTTP(sseRec, sseReq)
	if sseRec.Code != 200 || !bytes.Contains(sseRec.Body.Bytes(), []byte("event:init")) {
		t.Fatalf("SSE stream did not return expected init event: code %d, body: %s", sseRec.Code, sseRec.Body.String())
	}
}

func TestModuleSyncOverviewAndFanout(t *testing.T) {
	h := upstreamsFixture(t)
	call := func(method, path string, body any, want int) []byte {
		t.Helper()
		var reqBody *bytes.Reader
		if body != nil {
			data, _ := json.Marshal(body)
			reqBody = bytes.NewReader(data)
		} else {
			reqBody = bytes.NewReader([]byte{})
		}
		r := httptest.NewRequest(method, path, reqBody)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", "Bearer upstreams-test-token-at-least-32-bytes")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w.Body.Bytes()
	}

	// 1. Initial report from node: brotli is NOT loaded
	now := time.Now().UnixMilli()
	modules := []map[string]any{
		{"name": "gzip", "available": true, "loaded": true, "source": "runtime response check"},
		{"name": "brotli", "available": false, "loaded": false, "source": "runtime response check"},
	}
	reportPayload := map[string]any{
		"checked_at":    now,
		"nginx_version": "1.30.4",
		"architecture":  "x86_64",
		"modules":       modules,
		"installable":   true,
	}
	call("POST", "/api/v1/module-sync/node-local-01/report", reportPayload, 204)

	// 2. Query Sync Overview: default brotli desired = false, actual = 0/1 loaded -> Synced
	var overview []struct {
		Name         string `json:"name"`
		Desired      bool   `json:"desired"`
		ActualLoaded int    `json:"actual_loaded"`
		TotalNodes   int    `json:"total_nodes"`
		SyncStatus   string `json:"sync_status"`
		FeatureReady bool   `json:"feature_ready"`
	}
	json.Unmarshal(call("GET", "/api/v1/settings/modules/sync-overview", nil, 200), &overview)
	if len(overview) == 0 {
		t.Fatalf("expected sync overview items, got empty")
	}
	var brotliItem struct {
		Name         string `json:"name"`
		Desired      bool   `json:"desired"`
		ActualLoaded int    `json:"actual_loaded"`
		TotalNodes   int    `json:"total_nodes"`
		SyncStatus   string `json:"sync_status"`
		FeatureReady bool   `json:"feature_ready"`
	}
	for _, item := range overview {
		if item.Name == "brotli" {
			brotliItem = item
		}
	}
	if brotliItem.Desired || brotliItem.SyncStatus != "Synced" || brotliItem.FeatureReady {
		t.Fatalf("unexpected brotli initial overview: %+v", brotliItem)
	}


	// 3. Set generic desired state for brotli = enabled: true (Fleet-wide)
	call("PUT", "/api/v1/settings/modules/brotli/desired", map[string]any{"enabled": true}, 200)

	// 4. Trigger Fanout Sync: should queue install_brotli for node-local-01
	var syncRes struct {
		QueuedJobs int      `json:"queued_jobs"`
		Nodes      []string `json:"node_ids"`
	}
	json.Unmarshal(call("POST", "/api/v1/settings/modules/sync", map[string]any{"module": "brotli"}, 200), &syncRes)

	// 5. Node polls and receives the install_brotli job
	var claimed struct {
		ID     int64  `json:"id"`
		Action string `json:"action"`
	}
	json.Unmarshal(call("POST", "/api/v1/module-sync/node-local-01/poll", nil, 200), &claimed)
	if claimed.Action != "install_brotli" || claimed.ID == 0 {
		t.Fatalf("expected node to poll install_brotli job, got: %+v", claimed)
	}

	// 6. While job is running, overview should show Progressing
	json.Unmarshal(call("GET", "/api/v1/settings/modules/sync-overview", nil, 200), &overview)
	for _, item := range overview {
		if item.Name == "brotli" && item.SyncStatus != "Progressing" {
			t.Fatalf("expected Progressing status while job active, got: %+v", item)
		}
	}

	// 7. Node finishes canary reload, brotli is now loaded, reports succeeded
	modules[1]["available"] = true
	modules[1]["loaded"] = true
	reportPayload["job_id"] = claimed.ID
	reportPayload["job_state"] = "succeeded"
	reportPayload["job_logs"] = "Brotli dynamic module loaded into candidate and verified."
	reportPayload["checked_at"] = time.Now().UnixMilli()
	call("POST", "/api/v1/module-sync/node-local-01/report", reportPayload, 204)

	// 8. Overview now converges to Synced and FeatureReady = true
	json.Unmarshal(call("GET", "/api/v1/settings/modules/sync-overview", nil, 200), &overview)
	for _, item := range overview {
		if item.Name == "brotli" {
			if !item.Desired || item.SyncStatus != "Synced" || !item.FeatureReady || item.ActualLoaded != 1 {
				t.Fatalf("expected brotli to be Synced & FeatureReady, got: %+v", item)
			}
		}
	}
}
