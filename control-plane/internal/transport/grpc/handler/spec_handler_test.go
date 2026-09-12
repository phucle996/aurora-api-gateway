package handler_test

import (
	"context"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/transport/grpc/handler"
	"aurora-waf.local/control-plane/internal/transport/grpc/pb"
)

type mockSpecService struct {
	syncFn   func(ctx context.Context, q entity.SpecSyncQuery) (*entity.SpecSyncResult, error)
	reportFn func(ctx context.Context, cmd entity.SpecReportCommand) error
}

func (m *mockSpecService) SyncSpec(ctx context.Context, q entity.SpecSyncQuery) (*entity.SpecSyncResult, error) {
	if m.syncFn != nil {
		return m.syncFn(ctx, q)
	}
	return &entity.SpecSyncResult{InSync: true, ReleaseID: 10, Hash: "hash-123"}, nil
}

func (m *mockSpecService) ReportSpec(ctx context.Context, cmd entity.SpecReportCommand) error {
	if m.reportFn != nil {
		return m.reportFn(ctx, cmd)
	}
	return nil
}


func TestSpecSyncHandler_SyncSpec(t *testing.T) {
	mockSvc := &mockSpecService{
		syncFn: func(ctx context.Context, q entity.SpecSyncQuery) (*entity.SpecSyncResult, error) {
			if q.CurrentHash == "valid-hash" {
				return &entity.SpecSyncResult{InSync: true, ReleaseID: 42, Hash: "valid-hash"}, nil
			}
			return &entity.SpecSyncResult{InSync: false, ReleaseID: 42, Hash: "new-hash", SpecJSON: "version: 1"}, nil
		},
	}

	h := handler.NewSpecSyncHandler(mockSvc)

	// Test InSync case
	resp, err := h.SyncSpec(context.Background(), &pb.SyncSpecRequest{
		NodeId:      "node-01",
		CurrentHash: "valid-hash",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp.InSync {
		t.Fatalf("expected InSync=true")
	}

	// Test OutOfSync case
	resp2, err := h.SyncSpec(context.Background(), &pb.SyncSpecRequest{
		NodeId:      "node-01",
		CurrentHash: "old-hash",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp2.InSync {
		t.Fatalf("expected InSync=false")
	}
	if resp2.SpecJson != "version: 1" {
		t.Fatalf("expected SpecJson='version: 1', got %s", resp2.SpecJson)
	}
}
