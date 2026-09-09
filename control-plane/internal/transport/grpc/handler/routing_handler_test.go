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

type mockDomainRoutingSyncService struct{}

func (m *mockDomainRoutingSyncService) DesiredRouting(ctx context.Context, query entity.DomainRoutingQuery) (entity.DomainRoutingResult, error) {
	return entity.DomainRoutingResult{
		Config: "server { listen 80; }",
		Digest: "digest-routing",
		Files: []entity.DomainRoutingFile{
			{Name: "test.pem", Content: []byte("CERT_CONTENT")},
		},
	}, nil
}

func TestDomainRoutingSyncHandler_Validation(t *testing.T) {
	svc := &mockDomainRoutingSyncService{}
	h := handler.NewDomainRoutingSyncHandler(svc)
	ctx := context.Background()

	t.Run("GetDomainRoutingBundle validation", func(t *testing.T) {
		_, err := h.GetDomainRoutingBundle(ctx, nil)
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.GetDomainRoutingBundle(ctx, &pb.GetDomainRoutingBundleRequest{NodeId: ""})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})
}

func TestDomainRoutingSyncHandler_E2E(t *testing.T) {
	svc := &mockDomainRoutingSyncService{}
	h := handler.NewDomainRoutingSyncHandler(svc)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer lis.Close()

	srv := grpc.NewServer()
	pb.RegisterDomainRoutingSyncServiceServer(srv, h)

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

	client := pb.NewDomainRoutingSyncServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := client.GetDomainRoutingBundle(ctx, &pb.GetDomainRoutingBundleRequest{NodeId: "node-routing-e2e"})
	if err != nil {
		t.Fatalf("GetDomainRoutingBundle e2e failed: %v", err)
	}
	if resp.Config != "server { listen 80; }" || resp.Digest != "digest-routing" || len(resp.Files) != 1 {
		t.Fatalf("unexpected response: %+v", resp)
	}
	if resp.Files[0].Name != "test.pem" || resp.Files[0].Content != "CERT_CONTENT" {
		t.Fatalf("unexpected file asset: %+v", resp.Files[0])
	}
}
