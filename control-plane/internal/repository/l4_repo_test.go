package repository_test

import (
	"context"
	"database/sql"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/migrations"
	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}

	if _, err := db.Exec(migrations.Tables); err != nil {
		t.Fatalf("run tables migration: %v", err)
	}
	return db
}

func TestL4Repository_CRUD(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	repo := repository.NewL4Repository(db, db)
	ctx := context.Background()

	// 1. Create Service targeting Upstream
	svc1, err := repo.CreateService(ctx, entity.CreateL4ServiceCommand{
		ID:                  "l4s_test1",
		Name:                "postgres_service",
		Protocol:            "tcp",
		ListenPort:          5432,
		ForwardTargetType:   "upstream",
		UpstreamName:        "pg_cluster",
		DirectEndpoint:      "",
		ACLRulesJSON:        `[{"cidr":"192.168.1.0/24","action":"allow"},{"cidr":"0.0.0.0/0","action":"deny"}]`,
		ProxyTimeout:        "1h",
		ProxyConnectTimeout: "5s",
		Enabled:             true,
		Description:         "Postgres edge listener",
	})
	if err != nil {
		t.Fatalf("create service 1 failed: %v", err)
	}
	if svc1.ListenPort != 5432 || svc1.ForwardTargetType != "upstream" || !svc1.Enabled {
		t.Errorf("unexpected service fields: %+v", svc1)
	}

	// 2. Create Service targeting Direct Endpoint
	svc2, err := repo.CreateService(ctx, entity.CreateL4ServiceCommand{
		ID:                  "l4s_test2",
		Name:                "redis_direct",
		Protocol:            "tcp",
		ListenPort:          6379,
		ForwardTargetType:   "endpoint",
		UpstreamName:        "",
		DirectEndpoint:      "10.0.0.15:6379",
		ACLRulesJSON:        `[]`,
		ProxyTimeout:        "30m",
		ProxyConnectTimeout: "2s",
		Enabled:             true,
		Description:         "Direct Redis forward",
	})
	if err != nil {
		t.Fatalf("create service 2 failed: %v", err)
	}
	if svc2.ForwardTargetType != "endpoint" || svc2.DirectEndpoint != "10.0.0.15:6379" {
		t.Errorf("unexpected service 2 fields: %+v", svc2)
	}

	// 3. Get Service by Port and Proto
	byPort, err := repo.GetServiceByPortProto(ctx, "tcp", 5432)
	if err != nil || byPort == nil || byPort.ID != "l4s_test1" {
		t.Fatalf("get service by port proto failed: %v", err)
	}

	// 4. Count Services by Upstream
	count, err := repo.CountServicesByUpstreamName(ctx, "pg_cluster")
	if err != nil || count != 1 {
		t.Fatalf("expected count 1, got %d (err: %v)", count, err)
	}

	// 5. GetAllActiveServices
	svcs, err := repo.GetAllActiveServices(ctx)
	if err != nil || len(svcs) != 2 {
		t.Fatalf("expected 2 active services, got %d (err: %v)", len(svcs), err)
	}

	// 6. Update Service
	updSvc, err := repo.UpdateService(ctx, entity.UpdateL4ServiceCommand{
		ID:                  "l4s_test1",
		Name:                "postgres_service_renamed",
		Protocol:            "tcp",
		ListenPort:          5433,
		ForwardTargetType:   "upstream",
		UpstreamName:        "pg_cluster",
		DirectEndpoint:      "",
		ACLRulesJSON:        `[]`,
		ProxyTimeout:        "2h",
		ProxyConnectTimeout: "10s",
		Enabled:             true,
		Description:         "Updated",
	})
	if err != nil || updSvc.ListenPort != 5433 {
		t.Fatalf("update service failed: %v", err)
	}

	// 7. Delete Service
	if err := repo.DeleteService(ctx, "l4s_test1"); err != nil {
		t.Fatalf("delete service failed: %v", err)
	}
	if _, err := repo.GetServiceByID(ctx, "l4s_test1"); err != taxonomy.ErrL4ServiceNotFound {
		t.Fatalf("expected ErrL4ServiceNotFound, got %v", err)
	}
}
