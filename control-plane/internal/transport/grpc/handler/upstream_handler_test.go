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

type mockUpstreamSyncService struct {
	lastReportNodeID    string
	lastReportReleaseID int64
	lastReportPhase     string
}

func (m *mockUpstreamSyncService) CreateUpstream(ctx context.Context, cmd entity.CreateUpstreamCommand) (*entity.UpstreamItem, error) {
	return nil, nil
}
func (m *mockUpstreamSyncService) UpdateUpstream(ctx context.Context, cmd entity.UpdateUpstreamCommand) (*entity.UpstreamItem, error) {
	return nil, nil
}
func (m *mockUpstreamSyncService) GetUpstream(ctx context.Context, id int64) (*entity.UpstreamItem, error) {
	return nil, nil
}
func (m *mockUpstreamSyncService) ListUpstreams(ctx context.Context, query entity.ListUpstreamsQuery) ([]entity.UpstreamItem, int, error) {
	return nil, 0, nil
}
func (m *mockUpstreamSyncService) DeleteUpstream(ctx context.Context, id int64) error {
	return nil
}
func (m *mockUpstreamSyncService) GetDesiredSnapshot(ctx context.Context, nodeID string) (*entity.UpstreamSnapshot, error) {
	return &entity.UpstreamSnapshot{ReleaseID: 15, Digest: "digest-upstreams", ConfigContent: "upstream backend { server 127.0.0.1:8080; }"}, nil
}
func (m *mockUpstreamSyncService) ReportSyncStatus(ctx context.Context, nodeID string, releaseID int64, phase, message string) error {
	m.lastReportNodeID = nodeID
	m.lastReportReleaseID = releaseID
	m.lastReportPhase = phase
	return nil
}

func TestUpstreamSyncHandler_Validation(t *testing.T) {
	svc := &mockUpstreamSyncService{}
	h := handler.NewUpstreamSyncHandler(svc)
	ctx := context.Background()

	t.Run("GetUpstreams validation", func(t *testing.T) {
		_, err := h.GetUpstreams(ctx, nil)
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.GetUpstreams(ctx, &pb.GetUpstreamsRequest{NodeId: ""})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})

	t.Run("ReportUpstreams validation", func(t *testing.T) {
		_, err := h.ReportUpstreams(ctx, &pb.ReportUpstreamsRequest{NodeId: "", ReleaseId: 5, Phase: "applied"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.ReportUpstreams(ctx, &pb.ReportUpstreamsRequest{NodeId: "node-01", ReleaseId: 0, Phase: "applied"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.ReportUpstreams(ctx, &pb.ReportUpstreamsRequest{NodeId: "node-01", ReleaseId: 5, Phase: "invalid"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})
}

func TestUpstreamSyncHandler_E2E(t *testing.T) {
	svc := &mockUpstreamSyncService{}
	h := handler.NewUpstreamSyncHandler(svc)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer lis.Close()

	srv := grpc.NewServer()
	pb.RegisterUpstreamSyncServiceServer(srv, h)

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

	client := pb.NewUpstreamSyncServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// 1. GetUpstreams
	resp, err := client.GetUpstreams(ctx, &pb.GetUpstreamsRequest{NodeId: "node-upstream-e2e"})
	if err != nil {
		t.Fatalf("GetUpstreams e2e failed: %v", err)
	}
	if resp.ReleaseId != 15 || resp.Digest != "digest-upstreams" || resp.ConfigContent != "upstream backend { server 127.0.0.1:8080; }" {
		t.Fatalf("unexpected response: %+v", resp)
	}

	// 2. ReportUpstreams
	repResp, err := client.ReportUpstreams(ctx, &pb.ReportUpstreamsRequest{
		NodeId:    "node-upstream-e2e",
		ReleaseId: 15,
		Phase:     "applied",
		Message:   "upstreams applied",
	})
	if err != nil || !repResp.Success {
		t.Fatalf("ReportUpstreams e2e failed: %v, resp: %+v", err, repResp)
	}
	if svc.lastReportNodeID != "node-upstream-e2e" || svc.lastReportReleaseID != 15 || svc.lastReportPhase != "applied" {
		t.Fatalf("unexpected report state: %+v", svc)
	}
}
