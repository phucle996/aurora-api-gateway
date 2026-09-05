package accessagent

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCursorSurvivesUncertainDeliveryAndIgnoresInjectedLog(t *testing.T) {
	dir := t.TempDir()
	log := filepath.Join(dir, "error.log")
	state := filepath.Join(dir, "cursor.json")
	line := "2026/09/06 01:00:00 [notice] 12#12: AuroraAccess generation=1 rule=2 ip=192.0.2.3\n"
	if e := os.WriteFile(log, []byte(line), 0600); e != nil {
		t.Fatal(e)
	}
	keys := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Key string `json:"key"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("bad request")
		}
		keys = append(keys, body.Key)
		if len(keys) == 1 {
			w.WriteHeader(503)
		} else {
			w.WriteHeader(204)
		}
	}))
	defer server.Close()
	f := Forwarder{Log: log, Cursor: state, Controller: server.URL, NodeID: "test-node", Token: "test-token", Client: server.Client()}
	if f.Step(context.Background()) == nil {
		t.Fatal("failed delivery acknowledged")
	}
	if e := f.Step(context.Background()); e != nil {
		t.Fatal(e)
	}
	if len(keys) != 2 || keys[0] != keys[1] {
		t.Fatal("retry key changed", keys)
	}
	if e := f.Step(context.Background()); e != nil {
		t.Fatal(e)
	}
	if len(keys) != 2 {
		t.Fatal("replayed committed cursor")
	}
	file, e := os.OpenFile(log, os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		t.Fatal(e)
	}
	_, e = file.WriteString("2026/09/06 01:00:00 [error] 12#12: bad request /AuroraAccess generation=1 rule=2 ip=192.0.2.3\n")
	file.Close()
	if e != nil {
		t.Fatal(e)
	}
	if e = f.Step(context.Background()); e != nil {
		t.Fatal(e)
	}
	if len(keys) != 2 {
		t.Fatal("untrusted log accepted")
	}
}
