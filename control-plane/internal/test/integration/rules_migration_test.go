package integration_test

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/app"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/migrations"
	"context"
	"path/filepath"
	"testing"
)

func TestRulesV2UpgradePreservesAuthority(t *testing.T) {
	for _, pending := range []bool{false, true} {
		name := "empty-journal"
		if pending {
			name = "unsettled-journal"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			path := filepath.Join(t.TempDir(), "state.db")
			db, err := infra.OpenSQLite(ctx, path)
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if _, err = db.Exec(migrations.Bootstrap + migrations.Rules + "INSERT INTO schema_migrations(version) VALUES(1),(2);"); err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec(`INSERT INTO rules(version,name,description,rule_group,action,severity,score,priority,path,enabled) VALUES(1,'preserved','','custom','block','high',5,1,'/guard',1)`); err != nil {
				t.Fatal(err)
			}
			if pending {
				if _, err = db.Exec(`INSERT INTO ruleset_releases(request_key,state) VALUES('pending-before-upgrade','pending'); INSERT INTO node_activation(singleton,release_id,phase) VALUES(1,1,'pending');`); err != nil {
					t.Fatal(err)
				}
			}
			a, err := app.NewApp(ctx, config.Config{SQLitePath: path})
			if pending {
				if err == nil {
					a.Close()
					t.Fatal("upgrade invented missing recovery data")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				a.Close()
			}
			var version, count int
			if err = db.QueryRow("SELECT max(version) FROM schema_migrations").Scan(&version); err != nil {
				t.Fatal(err)
			}
			want := 6
			if pending {
				want = 2
			}
			if version != want {
				t.Fatal(version)
			}
			if err = db.QueryRow("SELECT count(*) FROM rules WHERE name='preserved' AND path='/guard'").Scan(&count); err != nil || count != 1 {
				t.Fatal(count, err)
			}
			if pending {
				if err = db.QueryRow("SELECT count(*) FROM node_activation").Scan(&count); err != nil || count != 1 {
					t.Fatal(count, err)
				}
			}
		})
	}
}
