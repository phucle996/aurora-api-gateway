package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
)

func TestDomainBindingMutationBoundaries(t *testing.T) {
	h := upstreamsFixture(t)
	call := func(method, path, body string, status int) map[string]any {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Authorization", "Bearer upstreams-test-token-at-least-32-bytes")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		out := map[string]any{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out
	}
	call("POST", "/api/v1/domains", `{"domain":"app.test","upstream":"missing"}`, 400)
	call("POST", "/api/v1/domains", `{"domain":"a;return 200;.test","upstream":"http://127.0.0.1"}`, 400)
	call("POST", "/api/v1/upstreams", `{"name":"unsafe","architecture_type":"Single Server","servers":[{"address":"127.0.0.1;return 200;"}]}`, 400)
	call("POST", "/api/v1/upstreams", `{"name":"unsupported","architecture_type":"Single Server","servers":[{"address":"127.0.0.1"}],"transport":{"httpVersion":"HTTP/9"}}`, 400)
	u := call("POST", "/api/v1/upstreams", `{"name":"pool","architecture_type":"Single Server","servers":[{"address":"127.0.0.1:8080"}]}`, 201)
	up := fmt.Sprintf("/api/v1/upstreams/%.0f", u["id"])
	d := call("POST", "/api/v1/domains", `{"domain":"App.Test","upstream":"pool"}`, 201)
	dp := fmt.Sprintf("/api/v1/domains/%.0f", d["id"])
	if d["domain"] != "app.test" {
		t.Fatal("hostname not normalized")
	}
	call("DELETE", up, "", 400)
	call("PUT", dp, `{"upstream":"missing"}`, 400)
	if call("GET", dp, "", 200)["upstream"] != "pool" {
		t.Fatal("rejected mutation changed binding")
	}
	call("PUT", up, `{"name":"renamed","architecture_type":"Single Server","servers":[{"address":"127.0.0.1:8081"}]}`, 200)
	if call("GET", dp, "", 200)["upstream"] != "renamed" {
		t.Fatal("rename did not preserve binding")
	}
	call("PUT", dp, `{"upstream":"http://127.0.0.1:8082"}`, 200)
	call("DELETE", up, "", 200)
	call("DELETE", dp, "", 200)
	call("GET", "/api/v1/domain-routing/unknown", "", 422)
}
