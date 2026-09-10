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
	if _, err := db.Exec(migrations.RoutingAndCertificates); err != nil {
		t.Fatalf("failed to execute routing & certificates migrations: %v", err)
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

		-- Seed Route
		INSERT INTO routes (id, name, host, path, upstream_name, enabled)
		VALUES ('rt_1', 'service.local', 'service.local', '/', 'app', 1);
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

func TestSpecSyncRepository_SpecRelease_Lifecycle(t *testing.T) {
	db := setupSpecTestDB(t)
	defer db.Close()

	repo := repository.NewSpecSyncRepository(db, db)
	ctx := context.Background()

	// 1. Initially no active spec release
	active, err := repo.GetActiveSpecRelease(ctx)
	if err != nil {
		t.Fatalf("unexpected error getting active release: %v", err)
	}
	if active != nil {
		t.Fatalf("expected nil active release initially, got %+v", active)
	}

	// 2. Publish Revision 1
	rel1, err := repo.PublishSpecRelease(ctx, entity.ClusterSpecRelease{
		Digest:        "hash-revision-1",
		SpecYAML:      "version: 1\n",
		Actor:         "admin",
		ChangeSummary: "Initial baseline",
	})
	if err != nil {
		t.Fatalf("failed to publish release 1: %v", err)
	}
	if rel1.ID != 1 || rel1.Digest != "hash-revision-1" {
		t.Errorf("unexpected release 1 result: %+v", rel1)
	}

	// 3. GetActiveSpecRelease now returns Revision 1
	active1, err := repo.GetActiveSpecRelease(ctx)
	if err != nil || active1 == nil {
		t.Fatalf("failed to get active release 1: %v", err)
	}
	if active1.ID != 1 || active1.Digest != "hash-revision-1" || active1.SpecYAML != "version: 1\n" {
		t.Errorf("unexpected active 1: %+v", active1)
	}

	// 4. Publish Revision 2
	rel2, err := repo.PublishSpecRelease(ctx, entity.ClusterSpecRelease{
		Digest:        "hash-revision-2",
		SpecYAML:      "version: 2\n",
		Actor:         "secops",
		ChangeSummary: "Update rules",
	})
	if err != nil {
		t.Fatalf("failed to publish release 2: %v", err)
	}
	if rel2.ID != 2 || rel2.Digest != "hash-revision-2" {
		t.Errorf("unexpected release 2 result: %+v", rel2)
	}

	// 5. GetActiveSpecRelease now returns Revision 2
	active2, err := repo.GetActiveSpecRelease(ctx)
	if err != nil || active2 == nil {
		t.Fatalf("failed to get active release 2: %v", err)
	}
	if active2.ID != 2 || active2.Digest != "hash-revision-2" {
		t.Errorf("unexpected active 2: %+v", active2)
	}
}

