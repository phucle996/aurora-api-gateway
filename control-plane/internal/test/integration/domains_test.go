package integration_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

func domainsFixture(t *testing.T) http.Handler {
	t.Helper()
	path := filepath.Join(t.TempDir(), "domains.db")
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

	// Seed test fixtures into the test database
	_, err = pools.Writer.Exec(`
		INSERT INTO domains (domain, root_domain, status, tls_type, upstream, tags_json) VALUES
		('api.example.com', 'example.com', 'Active', 'Let''s Encrypt', 'http://10.0.1.10:8080', '["api","prod"]'),
		('admin.example.com', 'example.com', 'Active', 'Custom Cert', 'http://10.0.1.20:8080', '["admin","internal"]'),
		('www.example.com', 'example.com', 'Active', 'Let''s Encrypt', 'http://10.0.1.10:8080', '["public"]'),
		('app.vietnam.com', 'vietnam.com', 'Inactive', 'Custom Cert', 'http://10.10.1.5:8080', '["staging"]'),
		('auth.example.com', 'example.com', 'Active', 'mTLS', 'https://auth.internal:8443', '["auth","secure"]'),
		('static.example.com', 'example.com', 'Active', 'Let''s Encrypt', 'http://10.0.2.10:8080', '["static"]'),
		('blog.example.com', 'example.com', 'Active', 'Let''s Encrypt', 'http://10.0.1.11:8080', '["blog"]'),
		('dev.example.com', 'example.com', 'Inactive', 'Self-signed', 'http://10.0.3.10:8080', '["dev"]'),
		('b2b.example.com', 'example.com', 'Active', 'mTLS', 'https://b2b.internal:8443', '["b2b"]'),
		('shop.example.com', 'example.com', 'Active', 'Let''s Encrypt', 'http://10.0.1.12:8080', '["shop"]'),
		('gateway.internal.net', 'internal.net', 'Active', 'mTLS', 'https://gateway.internal:9443', '["internal"]'),
		('docs.example.com', 'example.com', 'Active', 'Let''s Encrypt', 'http://10.0.2.20:8080', '["public"]');
	`)
	if err != nil {
		t.Fatalf("failed to seed test fixture: %v", err)
	}

	router := gin.New()
	module := app.NewModule(pools.Writer, pools.Reader, config.Config{CompilerPath: os.Getenv("AURORA_TEST_COMPILER")})
	app.RegisterRoutes(router, module, "domains-test-token-at-least-32-bytes")
	return router
}

func TestDomainsWorkflow_List(t *testing.T) {
	mux := domainsFixture(t)
	token := "domains-test-token-at-least-32-bytes"

	request := func(method, path, auth string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, nil)
		if auth != "" {
			r.Header.Set("Authorization", "Bearer "+auth)
		}
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, r)
		return w
	}

	t.Run("Requires authentication", func(t *testing.T) {
		w := request("GET", "/api/v1/domains", "")
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got: %d", w.Code)
		}
	})

	t.Run("Returns seeded domains and stats", func(t *testing.T) {
		w := request("GET", "/api/v1/domains?page=1&limit=10", token)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got: %d (%s)", w.Code, w.Body.String())
		}

		var resp dto.ListDomainsResponse
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if resp.Counts.Total != 12 {
			t.Errorf("expected 12 total domains, got: %d", resp.Counts.Total)
		}
		if resp.Counts.Active != 10 {
			t.Errorf("expected 10 active domains, got: %d", resp.Counts.Active)
		}
		if resp.Counts.Inactive != 2 {
			t.Errorf("expected 2 inactive domains, got: %d", resp.Counts.Inactive)
		}
		if resp.Counts.MTLSEnabled != 3 {
			t.Errorf("expected 3 mTLS enabled domains, got: %d", resp.Counts.MTLSEnabled)
		}
		if len(resp.Items) != 10 {
			t.Errorf("expected 10 items on page 1, got: %d", len(resp.Items))
		}
		if resp.TotalFiltered != 12 {
			t.Errorf("expected total_filtered 12, got: %d", resp.TotalFiltered)
		}
	})

	t.Run("Filter by status", func(t *testing.T) {
		w := request("GET", "/api/v1/domains?status=Inactive", token)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got: %d", w.Code)
		}

		var resp dto.ListDomainsResponse
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if len(resp.Items) != 2 {
			t.Errorf("expected 2 inactive items, got: %d", len(resp.Items))
		}
		for _, item := range resp.Items {
			if item.Status != "Inactive" {
				t.Errorf("expected status Inactive, got: %s", item.Status)
			}
		}
	})

	t.Run("Search by domain name", func(t *testing.T) {
		w := request("GET", "/api/v1/domains?search=shop", token)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got: %d", w.Code)
		}

		var resp dto.ListDomainsResponse
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}

		if len(resp.Items) != 1 {
			t.Fatalf("expected 1 item, got: %d", len(resp.Items))
		}
		if resp.Items[0].Domain != "shop.example.com" {
			t.Errorf("expected shop.example.com, got: %s", resp.Items[0].Domain)
		}
	})
}
