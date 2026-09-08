package integration_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"github.com/gin-gonic/gin"
)

func TestSQLiteRestartAndConnectionSettings(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "state ?#", "controller.db")
	cfg := config.Config{HTTPAddr: "127.0.0.1:0", SQLitePath: path}
	a, err := app.NewApp(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := infra.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, "CREATE TABLE restart_fixture (value TEXT); INSERT INTO restart_fixture VALUES ('retained')"); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	a, err = app.NewApp(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	db, err = infra.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var value string
	if err := db.QueryRowContext(ctx, "SELECT value FROM restart_fixture").Scan(&value); err != nil || value != "retained" {
		t.Fatalf("value = %q, err = %v", value, err)
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM schema_migrations").Scan(&count); err != nil || count != 4 {
		t.Fatalf("migration count = %d, err = %v", count, err)
	}
	// Force replacement connections to verify per-connection settings survive churn.
	db.SetMaxIdleConns(0)
	for query, want := range map[string]string{
		"PRAGMA journal_mode": "wal", "PRAGMA foreign_keys": "1",
		"PRAGMA busy_timeout": "5000", "PRAGMA synchronous": "2",
	} {
		var got string
		if err := db.QueryRowContext(ctx, query).Scan(&got); err != nil || got != want {
			t.Errorf("%s = %q, want %q, err = %v", query, got, want, err)
		}
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO schema_migrations (version) VALUES (999)"); err != nil {
		t.Fatal(err)
	}
	if future, err := app.NewApp(ctx, cfg); err == nil {
		future.Close()
		t.Fatal("newer schema should reject startup")
	}
}

func TestReadinessFailsWhenStorageCloses(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "controller.db")
	a, err := app.NewApp(ctx, config.Config{SQLitePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	pools, err := infra.OpenSQLitePool(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()
	router := gin.New()
	app.RegisterRoutes(router, app.NewModule(pools.Writer, pools.Reader, config.Config{}), "")
	check := func(path string, want int) {
		t.Helper()
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != want {
			t.Fatalf("%s status = %d, want %d", path, response.Code, want)
		}
	}
	check("/readyz", http.StatusOK)
	// Closing the Reader DB simulates storage unavailability for the readiness check
	if err := pools.Reader.Close(); err != nil {
		t.Fatal(err)
	}
	check("/readyz", http.StatusServiceUnavailable)
	check("/healthz", http.StatusOK)
	check("/api/v1/status", http.StatusOK)
}

func TestInvalidDatabaseFailsStartup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.db")
	if err := os.WriteFile(path, []byte("not a SQLite database"), 0600); err != nil {
		t.Fatal(err)
	}
	if a, err := app.NewApp(context.Background(), config.Config{SQLitePath: path}); err == nil {
		a.Close()
		t.Fatal("invalid database should reject startup")
	}
}

func TestSQLiteReadWritePool(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "pool_test.db")
	pools, err := infra.OpenSQLitePool(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer pools.Close()

	// 1. Writer can perform schema migration and inserts
	if _, err := pools.Writer.ExecContext(ctx, "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('item1'), ('item2')"); err != nil {
		t.Fatalf("writer mutation failed: %v", err)
	}

	// 2. Reader can read written data
	var count int
	if err := pools.Reader.QueryRowContext(ctx, "SELECT COUNT(*) FROM items").Scan(&count); err != nil || count != 2 {
		t.Fatalf("reader query failed: count=%d, err=%v", count, err)
	}

	// 3. Reader strictly rejects writes (mode=ro / query_only)
	if _, err := pools.Reader.ExecContext(ctx, "INSERT INTO items (name) VALUES ('item3')"); err == nil {
		t.Fatal("expected reader execution of INSERT to fail, but it succeeded")
	}

	// 4. Concurrent readers execute without locking
	done := make(chan error, 10)
	for i := 0; i < 10; i++ {
		go func() {
			var n int
			err := pools.Reader.QueryRowContext(ctx, "SELECT count(*) FROM items").Scan(&n)
			done <- err
		}()
	}
	for i := 0; i < 10; i++ {
		if err := <-done; err != nil {
			t.Fatalf("concurrent reader failed: %v", err)
		}
	}
}
