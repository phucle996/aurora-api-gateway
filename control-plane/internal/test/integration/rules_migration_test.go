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
		{name: "from-version-6", initVersion: 6, expectError: false},
		{name: "from-version-7", initVersion: 7, expectError: false},
		{name: "from-version-8", initVersion: 8, expectError: false},
		{name: "from-version-9", initVersion: 9, expectError: false},
		{name: "from-version-10", initVersion: 10, expectError: false},
		{name: "from-version-11", initVersion: 11, expectError: false},
		{name: "from-version-12", initVersion: 12, expectError: false},
		{name: "from-version-13-idempotent", initVersion: 13, expectError: false},
		{name: "unsupported-future-version", initVersion: 14, expectError: true},
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
				if _, err = db.Exec(migrations.Domains); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 6 {
				if _, err = db.Exec(migrations.Upstreams); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 7 {
				if _, err = db.Exec(migrations.RateLimits); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 8 {
				if _, err = db.Exec(migrations.RateLimitMetrics); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 9 {
				if _, err = db.Exec(migrations.SecuritySettings); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 10 {
				if _, err = db.Exec(migrations.NotificationChannels); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 11 {
				if _, err = db.Exec(migrations.BackupSettings); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 12 {
				if _, err = db.Exec(migrations.OriginObservations); err != nil {
					t.Fatal(err)
				}
			}
			if tc.initVersion >= 13 {
				if _, err = db.Exec(migrations.NodeDependencies); err != nil {
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
			if version != 13 {
				t.Fatalf("expected max version 13, got %d", version)
			}
			if err = db.QueryRow("SELECT count(*) FROM rules WHERE name='preserved' AND path='/guard'").Scan(&count); err != nil || count != 1 {
				t.Fatalf("expected preserved rule count 1, got %d (err: %v)", count, err)
			}
		})
	}
}
