package service_test

import (
	"context"
	"database/sql"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"aurora-waf.local/control-plane/migrations"
	_ "modernc.org/sqlite"
)

func setupServiceTestDB(t *testing.T) *sql.DB {
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

func TestL4Service_Orchestration(t *testing.T) {
	db := setupServiceTestDB(t)
	defer db.Close()

	l4Repo := repository.NewL4Repository(db, db)
	mutationCount := 0
	svc := service.NewL4Service(l4Repo, func() {
		mutationCount++
	})
	ctx := context.Background()

	// 1. Create service: service should assign ID if missing, persist to repo, and notify mutation
	created, err := svc.CreateService(ctx, entity.CreateL4ServiceCommand{
		Name:              "redis_svc",
		Protocol:          "tcp",
		ListenPort:        6379,
		ForwardTargetType: "upstream",
		UpstreamName:      "redis_pool",
		Enabled:           true,
	})
	if err != nil {
		t.Fatalf("expected create service to succeed, got: %v", err)
	}
	if created.ID == "" {
		t.Errorf("expected auto-generated ID, got empty")
	}
	if mutationCount != 1 {
		t.Errorf("expected mutationCount = 1, got %d", mutationCount)
	}

	// 2. Query by ID and by Port/Proto
	byID, err := svc.GetServiceByID(ctx, created.ID)
	if err != nil || byID == nil {
		t.Fatalf("GetServiceByID failed: %v", err)
	}
	if byID.Name != "redis_svc" {
		t.Errorf("expected name redis_svc, got %s", byID.Name)
	}

	byPort, err := svc.GetServiceByPortProto(ctx, "tcp", 6379)
	if err != nil || byPort == nil {
		t.Fatalf("GetServiceByPortProto failed: %v", err)
	}
	if byPort.ID != created.ID {
		t.Errorf("expected ID %s, got %s", created.ID, byPort.ID)
	}

	// 3. Update service: updates repo and triggers mutation
	updated, err := svc.UpdateService(ctx, entity.UpdateL4ServiceCommand{
		ID:                  created.ID,
		Name:                "redis_svc_updated",
		Protocol:            "tcp",
		ListenPort:          6379,
		ForwardTargetType:   "upstream",
		UpstreamName:        "redis_pool",
		Enabled:             false,
		ProxyTimeout:        "2h",
		ProxyConnectTimeout: "10s",
	})
	if err != nil {
		t.Fatalf("expected update service to succeed, got: %v", err)
	}
	if updated.Name != "redis_svc_updated" || updated.Enabled != false {
		t.Errorf("unexpected updated entity: %+v", updated)
	}
	if mutationCount != 2 {
		t.Errorf("expected mutationCount = 2, got %d", mutationCount)
	}

	// 4. List services
	items, total, err := svc.ListServices(ctx, entity.ListL4ServicesQuery{Limit: 10})
	if err != nil {
		t.Fatalf("ListServices failed: %v", err)
	}
	if total != 1 || len(items) != 1 {
		t.Errorf("expected 1 item, got total=%d len=%d", total, len(items))
	}

	// 5. Delete service: deletes from repo and triggers mutation
	if err := svc.DeleteService(ctx, created.ID); err != nil {
		t.Fatalf("DeleteService failed: %v", err)
	}
	if mutationCount != 3 {
		t.Errorf("expected mutationCount = 3, got %d", mutationCount)
	}

	// Confirm deletion
	afterDel, err := svc.GetServiceByID(ctx, created.ID)
	if err == nil || afterDel != nil {
		t.Errorf("expected error/nil after delete, got err=%v item=%v", err, afterDel)
	}
}
