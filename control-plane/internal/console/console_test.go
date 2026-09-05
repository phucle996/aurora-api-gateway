package console

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEmbeddedConsoleBoundaries(t *testing.T) {
	handler, err := NewHandler()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		method, path string
		code         int
	}{
		{"GET", "/", 200}, {"GET", "/rules", 200}, {"HEAD", "/", 200},
		{"GET", "/api/missing", 404}, {"GET", "/api", 404},
		{"GET", "/assets/missing.js", 404}, {"GET", "/.env", 404},
		{"POST", "/", 405},
	} {
		r := httptest.NewRecorder()
		handler.ServeHTTP(r, httptest.NewRequest(tc.method, tc.path, nil))
		if r.Code != tc.code {
			t.Errorf("%s %s: %d", tc.method, tc.path, r.Code)
		}
		if tc.code == 200 && tc.method == "GET" && !strings.Contains(r.Body.String(), "Aurora WAF") {
			t.Error("missing embedded UI")
		}
		if tc.method == "HEAD" && r.Body.Len() != 0 {
			t.Error("HEAD returned body")
		}
	}
}
