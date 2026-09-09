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

type mockPolicySyncService struct {
	lastReport entity.PolicyReportCommand
}

func (m *mockPolicySyncService) Save(context.Context, entity.SavePolicyCommand) (entity.SavePolicyResult, error) {
	return entity.SavePolicyResult{}, nil
}
func (m *mockPolicySyncService) Publish(context.Context, entity.PublishPolicyCommand) (entity.PublishPolicyResult, error) {
	return entity.PublishPolicyResult{}, nil
}
func (m *mockPolicySyncService) ReadPolicies(context.Context, entity.ReadPoliciesQuery) ([]entity.ReadPoliciesItem, error) {
	return nil, nil
}
func (m *mockPolicySyncService) PolicyCatalog(context.Context) ([]entity.PolicyCatalogItem, error) {
	return nil, nil
}
func (m *mockPolicySyncService) PolicyRuleCatalog(context.Context) ([]entity.PolicyCatalogRule, error) {
	return nil, nil
}
func (m *mockPolicySyncService) PolicyCluster(context.Context) (entity.PolicyClusterStatus, error) {
	return entity.PolicyClusterStatus{}, nil
}
func (m *mockPolicySyncService) PolicySync(context.Context, entity.PolicySyncQuery) (entity.PolicySyncResult, error) {
	return entity.PolicySyncResult{ReleaseID: 42, Digest: "sha256-policy", Payload: []byte(`{"rules":[]}`)}, nil
}
func (m *mockPolicySyncService) PolicyReport(ctx context.Context, cmd entity.PolicyReportCommand) error {
	m.lastReport = cmd
	return nil
}

func TestPolicySyncHandler_Validation(t *testing.T) {
	policySvc := &mockPolicySyncService{}
	h := handler.NewPolicySyncHandler(policySvc)
	ctx := context.Background()

	t.Run("GetPolicy nil", func(t *testing.T) {
		_, err := h.GetPolicy(ctx, nil)
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})

	t.Run("GetPolicy empty node_id", func(t *testing.T) {
		_, err := h.GetPolicy(ctx, &pb.GetPolicyRequest{NodeId: ""})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})

	t.Run("ReportPolicy invalid phase", func(t *testing.T) {
		_, err := h.ReportPolicy(ctx, &pb.ReportPolicyRequest{
			NodeId:    "node-01",
			ReleaseId: 1,
			Phase:     "unknown_phase",
		})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})

	t.Run("ReportPolicy invalid release_id", func(t *testing.T) {
		_, err := h.ReportPolicy(ctx, &pb.ReportPolicyRequest{
			NodeId:    "node-01",
			ReleaseId: 0,
			Phase:     "applied",
		})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})
}

func TestPolicySyncHandler_E2E(t *testing.T) {
	policySvc := &mockPolicySyncService{}
	h := handler.NewPolicySyncHandler(policySvc)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer lis.Close()

	srv := grpc.NewServer()
	pb.RegisterPolicySyncServiceServer(srv, h)

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

	client := pb.NewPolicySyncServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// 1. GetPolicy
	resp, err := client.GetPolicy(ctx, &pb.GetPolicyRequest{NodeId: "node-policy-e2e"})
	if err != nil {
		t.Fatalf("GetPolicy e2e failed: %v", err)
	}
	if resp.ReleaseId != 42 || resp.Digest != "sha256-policy" || resp.PayloadJson != `{"rules":[]}` {
		t.Errorf("unexpected policy response: %+v", resp)
	}

	// 2. ReportPolicy
	repResp, err := client.ReportPolicy(ctx, &pb.ReportPolicyRequest{
		NodeId:    "node-policy-e2e",
		ReleaseId: 42,
		Phase:     "applied",
		Message:   "policy applied successfully",
	})
	if err != nil || !repResp.Success {
		t.Fatalf("ReportPolicy e2e failed: %v, resp: %+v", err, repResp)
	}
	if policySvc.lastReport.NodeID != "node-policy-e2e" || policySvc.lastReport.ReleaseID != 42 || policySvc.lastReport.Phase != "applied" {
		t.Errorf("unexpected last report: %+v", policySvc.lastReport)
	}
}
