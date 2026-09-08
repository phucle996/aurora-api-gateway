package repository_test

import (
	"context"
	"database/sql"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/migrations"
	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open sqlite in-memory: %v", err)
	}

	// Run migration 1 (tables schema)
	if _, err := db.Exec(migrations.Tables); err != nil {
		t.Fatalf("failed to execute migrations.Tables: %v", err)
	}

	// Seed test fixtures
	_, err = db.Exec(`
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

	return db
}

func TestDomainRepository_ListDomains(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	repo := repository.NewDomainRepository(db, db)
	ctx := context.Background()

	t.Run("List all with default pagination", func(t *testing.T) {
		res, err := repo.ListDomains(ctx, entity.ListDomainsQuery{
			Limit:  10,
			Offset: 0,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if res.Counts.Total != 12 {
			t.Errorf("expected total 12, got %d", res.Counts.Total)
		}
		if res.Counts.Active != 10 {
			t.Errorf("expected active 10, got %d", res.Counts.Active)
		}
		if res.Counts.Inactive != 2 {
			t.Errorf("expected inactive 2, got %d", res.Counts.Inactive)
		}
		if res.Counts.MTLSEnabled != 3 {
			t.Errorf("expected mtls 3, got %d", res.Counts.MTLSEnabled)
		}
		if len(res.Items) != 10 {
			t.Errorf("expected 10 items on page 1, got %d", len(res.Items))
		}
		if res.TotalFiltered != 12 {
			t.Errorf("expected total_filtered 12, got %d", res.TotalFiltered)
		}
	})

	t.Run("Filter by status Inactive", func(t *testing.T) {
		res, err := repo.ListDomains(ctx, entity.ListDomainsQuery{
			Status: "Inactive",
			Limit:  10,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if len(res.Items) != 2 {
			t.Errorf("expected 2 inactive items, got %d", len(res.Items))
		}
		for _, it := range res.Items {
			if it.Status != "Inactive" {
				t.Errorf("expected status Inactive, got %s", it.Status)
			}
		}
	})

	t.Run("Filter by search term", func(t *testing.T) {
		res, err := repo.ListDomains(ctx, entity.ListDomainsQuery{
			Search: "auth",
			Limit:  10,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if len(res.Items) != 1 {
			t.Fatalf("expected 1 item for search 'auth', got %d", len(res.Items))
		}
		if res.Items[0].Domain != "auth.example.com" {
			t.Errorf("expected auth.example.com, got %s", res.Items[0].Domain)
		}
	})

	t.Run("Filter by tag", func(t *testing.T) {
		res, err := repo.ListDomains(ctx, entity.ListDomainsQuery{
			Tag:   "prod",
			Limit: 10,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if len(res.Items) == 0 {
			t.Errorf("expected at least 1 item with tag 'prod'")
		}
	})
}
