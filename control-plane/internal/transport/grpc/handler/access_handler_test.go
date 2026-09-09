package handler_test

import (
	"context"
	"net"
	"testing"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/transport/grpc/handler"
	"aurora-waf.local/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

type mockAccessSyncService struct {
	lastReport entity.AccessReportCommand
}

func (m *mockAccessSyncService) Change(ctx context.Context, c entity.AccessChangeCommand) (entity.AccessChangeResult, error) {
	return entity.AccessChangeResult{}, nil
}
func (m *mockAccessSyncService) Read(ctx context.Context, q entity.AccessReadQuery) ([]entity.AccessReadItem, error) {
	return nil, nil
}
func (m *mockAccessSyncService) Status(ctx context.Context) (entity.AccessStatusResult, error) {
	return entity.AccessStatusResult{}, nil
}
func (m *mockAccessSyncService) Desired(ctx context.Context, q entity.AccessSyncQuery) (entity.AccessSyncResult, error) {
	return entity.AccessSyncResult{ReleaseID: 10, Digest: "digest-access", Payload: []byte(`{"rules":[]}`)}, nil
}
func (m *mockAccessSyncService) Report(ctx context.Context, c entity.AccessReportCommand) error {
	m.lastReport = c
	return nil
}
func (m *mockAccessSyncService) Match(ctx context.Context, c entity.AccessMatchCommand) error {
	return nil
}
func (m *mockAccessSyncService) Activity(ctx context.Context) ([]entity.AccessActivityItem, error) {
	return nil, nil
}
func (m *mockAccessSyncService) Catalog(ctx context.Context) (entity.AccessCatalog, error) {
	return entity.AccessCatalog{}, nil
}

func TestAccessSyncHandler_Validation(t *testing.T) {
	svc := &mockAccessSyncService{}
	h := handler.NewAccessSyncHandler(svc)
	ctx := context.Background()

	t.Run("GetAccess validation", func(t *testing.T) {
		_, err := h.GetAccess(ctx, nil)
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.GetAccess(ctx, &pb.GetAccessRequest{NodeId: ""})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})

	t.Run("ReportAccess validation", func(t *testing.T) {
		_, err := h.ReportAccess(ctx, &pb.ReportAccessRequest{NodeId: "", ReleaseId: 10, Phase: "applied"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.ReportAccess(ctx, &pb.ReportAccessRequest{NodeId: "node-01", ReleaseId: 0, Phase: "applied"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.ReportAccess(ctx, &pb.ReportAccessRequest{NodeId: "node-01", ReleaseId: 10, Phase: "bad"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})
}

func TestAccessSyncHandler_E2E(t *testing.T) {
	svc := &mockAccessSyncService{}
	h := handler.NewAccessSyncHandler(svc)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer lis.Close()

	srv := grpc.NewServer()
	pb.RegisterAccessSyncServiceServer(srv, h)

	go func() {
		_ = srv.Serve(lis)
	}()
	defer srv.GracefulStop()

	conn, err := grpc.NewClient(
		lis.Addr().String(),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}
	defer conn.Close()

	client := pb.NewAccessSyncServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// 1. GetAccess
	resp, err := client.GetAccess(ctx, &pb.GetAccessRequest{NodeId: "node-access-e2e"})
	if err != nil {
		t.Fatalf("GetAccess e2e failed: %v", err)
	}
	if resp.ReleaseId != 10 || resp.Digest != "digest-access" {
		t.Errorf("unexpected access response: %+v", resp)
	}

	// 2. ReportAccess
	repResp, err := client.ReportAccess(ctx, &pb.ReportAccessRequest{
		NodeId:    "node-access-e2e",
		ReleaseId: 10,
		Phase:     "applied",
		Message:   "access applied",
	})
	if err != nil || !repResp.Success {
		t.Fatalf("ReportAccess e2e failed: %v, resp: %+v", err, repResp)
	}
	if svc.lastReport.NodeID != "node-access-e2e" || svc.lastReport.ReleaseID != 10 || svc.lastReport.Phase != "applied" {
		t.Errorf("unexpected last report: %+v", svc.lastReport)
	}
}
