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

func setupSpecTestDB(t *testing.T) *sql.DB {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open sqlite in-memory: %v", err)
	}

	if _, err := db.Exec(migrations.Tables); err != nil {
		t.Fatalf("failed to execute migrations: %v", err)
	}
	if _, err := db.Exec(migrations.Seeds); err != nil {
		t.Fatalf("failed to execute seeds: %v", err)
	}

	// Seed cluster node
	_, err = db.Exec(`
		INSERT INTO cluster_nodes (id, name, ip, hostname, role, status, sync_status)
		VALUES ('node-test-1', 'Test Node 1', '10.0.0.1', 'edge-1', 'Edge Node', 'Ready', 'In Sync');

		-- Seed WAF policy release
		INSERT INTO policy_cluster_releases (id, payload, digest, membership, actor)
		VALUES (10, '{"version":1,"waf_enabled":true}', 'digest-waf', '[]', 'admin');
		INSERT INTO policy_cluster_head (singleton, release_id) VALUES (1, 10);

		-- Seed Access release
		INSERT INTO access_releases (id, payload, digest, actor)
		VALUES (20, '{"rules":[]}', 'digest-acc', 'admin');
		INSERT INTO access_head (singleton, release_id) VALUES (1, 20);

		-- Seed Upstream release
		INSERT INTO upstream_releases (release_id, digest, config_content)
		VALUES (30, 'digest-ups', 'upstream app { server 10.0.1.1:8080; }
');

		-- Seed Domain routing
		INSERT INTO domains (id, domain, root_domain, status, upstream)
		VALUES (1, 'service.local', 'service.local', 'Active', 'app');
	`)
	if err != nil {
		t.Fatalf("failed to seed test db: %v", err)
	}

	return db
}

func TestSpecSyncRepository_GetAuthorityData_Success(t *testing.T) {
	db := setupSpecTestDB(t)
	defer db.Close()

	repo := repository.NewSpecSyncRepository(db, db)
	ctx := context.Background()

	auth, err := repo.GetAuthorityData(ctx, "node-test-1")
	if err != nil {
		t.Fatalf("unexpected error getting authority: %v", err)
	}

	if auth.NodeID != "node-test-1" {
		t.Errorf("expected node ID node-test-1, got %s", auth.NodeID)
	}
	if auth.WAFReleaseID != 10 {
		t.Errorf("expected WAF release 10, got %d", auth.WAFReleaseID)
	}
	if string(auth.WAFPayload) != `{"version":1,"waf_enabled":true}` {
		t.Errorf("unexpected WAF payload: %s", string(auth.WAFPayload))
	}
	if auth.AccessReleaseID != 20 {
		t.Errorf("expected Access release 20, got %d", auth.AccessReleaseID)
	}
	if string(auth.AccessPayload) != `{"rules":[]}` {
		t.Errorf("unexpected Access payload: %s", string(auth.AccessPayload))
	}
	if auth.UpstreamsConf != "upstream app { server 10.0.1.1:8080; }\n" {
		t.Errorf("unexpected UpstreamsConf: %s", auth.UpstreamsConf)
	}
	if len(auth.RoutingRecords) != 1 || auth.RoutingRecords[0].Host != "service.local" {
		t.Errorf("unexpected RoutingRecords: %+v", auth.RoutingRecords)
	}
	if len(auth.Extensions) == 0 {
		t.Errorf("expected seeded extensions to be loaded, got 0")
	}
}

func TestSpecSyncRepository_GetAuthorityData_UnregisteredNode(t *testing.T) {
	db := setupSpecTestDB(t)
	defer db.Close()

	repo := repository.NewSpecSyncRepository(db, db)
	ctx := context.Background()

	_, err := repo.GetAuthorityData(ctx, "non-existent-node")
	if err == nil {
		t.Fatalf("expected error for non-existent node")
	}
}

func TestSpecSyncRepository_RecordReport(t *testing.T) {
	db := setupSpecTestDB(t)
	defer db.Close()

	repo := repository.NewSpecSyncRepository(db, db)
	ctx := context.Background()

	cmd := entity.SpecReportCommand{
		NodeID:    "node-test-1",
		ReleaseID: 99,
		Hash:      "abcd1234",
		Status:    "in_sync",
		Message:   "Applied OK",
	}
	if err := repo.RecordReport(ctx, cmd); err != nil {
		t.Fatalf("unexpected error recording report: %v", err)
	}

	// Verify update in cluster_nodes
	var observedRel int64
	var syncStatus string
	err := db.QueryRowContext(ctx, "SELECT observed_release_id, sync_status FROM cluster_nodes WHERE id = 'node-test-1'").Scan(&observedRel, &syncStatus)
	if err != nil {
		t.Fatalf("failed to query node: %v", err)
	}
	if observedRel != 99 {
		t.Errorf("expected observed_release_id 99, got %d", observedRel)
	}
	if syncStatus != "In Sync" {
		t.Errorf("expected sync_status 'In Sync', got %s", syncStatus)
	}
}
