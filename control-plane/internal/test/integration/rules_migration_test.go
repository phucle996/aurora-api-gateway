package integration_test

import (
	"context"
	"path/filepath"
	"testing"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/migrations"
)

func TestTypedMigrationUpgradePreservesAuthority(t *testing.T) {
	for _, tc := range []struct {
		name        string
		initVersion int
		expectError bool
	}{
		{name: "from-version-1", initVersion: 1, expectError: false},
		{name: "from-version-2", initVersion: 2, expectError: false},
		{name: "from-version-3", initVersion: 3, expectError: false},
		{name: "from-version-4", initVersion: 4, expectError: false},
		{name: "from-version-5", initVersion: 5, expectError: false},
		{name: "from-version-6-idempotent", initVersion: 6, expectError: false},
		{name: "unsupported-future-version", initVersion: 7, expectError: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			path := filepath.Join(t.TempDir(), "state.db")
			db, err := infra.OpenSQLite(ctx, path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			// Pre-populate tables
			if _, err = db.Exec(migrations.Tables); err != nil {
				t.Fatal(err)
			}
			if tc.initVersion >= 2 {
				if _, err = db.Exec(migrations.Indexes); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 3 {
				if _, err = db.Exec(migrations.Triggers); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 4 {
				if _, err = db.Exec(migrations.Seeds); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 5 {
				if _, err = db.Exec(migrations.ExtensionSchemas); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 6 {
				if _, err = db.Exec(migrations.RoutingAndCertificates); err != nil {
					t.Fatal(err)
				}
			}
			for v := 1; v <= tc.initVersion; v++ {
				if _, err = db.Exec("INSERT INTO schema_migrations(version) VALUES(?)", v); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = db.Exec(`INSERT INTO rules(version,name,description,rule_group,action,severity,score,priority,path,enabled) VALUES(1,'preserved','','custom','block','high',5,1,'/guard',1)`); err != nil {
				t.Fatal(err)
			}

			a, err := app.NewApp(ctx, config.Config{SQLitePath: path})
			if tc.expectError {
				if err == nil {
					a.Close()
					t.Fatalf("expected error for %s, but got nil", tc.name)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %s: %v", tc.name, err)
			}
			a.Close()

			var version, count int
			if err = db.QueryRow("SELECT max(version) FROM schema_migrations").Scan(&version); err != nil {
				t.Fatal(err)
			}
			if version != 6 {
				t.Fatalf("expected max version 6, got %d", version)
			}
			if err = db.QueryRow("SELECT count(*) FROM rules WHERE name='preserved' AND path='/guard'").Scan(&count); err != nil || count != 1 {
				t.Fatalf("expected preserved rule count 1, got %d (err: %v)", count, err)
			}
		})
	}
}
