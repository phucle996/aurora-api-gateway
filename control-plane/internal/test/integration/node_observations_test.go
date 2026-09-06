package integration_test

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"context"
	"testing"
	"time"
)

func TestNodeObservationReplayReloadAndScope(t *testing.T) {
	pools, _ := rollingFixture(t)
	repo := repository.NewNodeRepository(pools.Writer)
	svc := service.NewNodeService(repo, nil, nil)
	ctx := context.Background()
	now := time.Now().Unix()
	hb := entity.NodeHeartbeatPayload{NodeID: "observed", Timestamp: now - 3, Hostname: "real-container", MetricsScope: "container", MetricsAvailable: true, RuntimeStartedAt: now - 123, WorkerIdentity: "worker-before", ActiveReleaseID: 1000000000001, Authentication: "Bearer / HTTP"}
	if _, err := svc.RecordHeartbeat(ctx, hb); err != nil {
		t.Fatal(err)
	}
	node, err := svc.GetNodeByID(ctx, hb.NodeID)
	if err != nil || node.Hostname != hb.Hostname || node.MetricsScope != "container" || node.RuntimeStartedAt != hb.RuntimeStartedAt || node.ActiveReleaseID == nil || *node.ActiveReleaseID != hb.ActiveReleaseID || node.Certificate != "Bearer / HTTP" {
		t.Fatal(node, err)
	}
	if err := repo.SetNodeCommand(ctx, hb.NodeID, "reload_process", "pending"); err != nil {
		t.Fatal(err)
	}
	hb.Timestamp++
	directive, err := svc.RecordHeartbeat(ctx, hb)
	if err != nil || directive.Action != "reload_process" {
		t.Fatal(directive, err)
	}
	hb.Timestamp++
	if _, err := svc.RecordHeartbeat(ctx, hb); err != nil {
		t.Fatal(err)
	}
	state, err := repo.GetHeartbeatState(ctx, hb.NodeID)
	if err != nil || state.ReloadStatus != "reloading" {
		t.Fatal("heartbeat alone confirmed reload", state, err)
	}
	hb.Timestamp++
	hb.WorkerIdentity = "worker-after"
	if _, err := svc.RecordHeartbeat(ctx, hb); err != nil {
		t.Fatal(err)
	}
	state, err = repo.GetHeartbeatState(ctx, hb.NodeID)
	if err != nil || state.ReloadStatus != "completed" {
		t.Fatal(state, err)
	}
	hb.Timestamp -= 2
	hb.ActiveReleaseID = 2
	hb.Hostname = "stale"
	if _, err := svc.RecordHeartbeat(ctx, hb); err != nil {
		t.Fatal(err)
	}
	node, err = svc.GetNodeByID(ctx, hb.NodeID)
	if err != nil || node.Hostname != "real-container" || *node.ActiveReleaseID != 1000000000001 {
		t.Fatal("stale event overwrote observation", node, err)
	}
	logs, err := repo.ListNodeSyncLogs(ctx, hb.NodeID, 30)
	if err != nil || len(logs) != 2 {
		t.Fatal(logs, err)
	}
}
