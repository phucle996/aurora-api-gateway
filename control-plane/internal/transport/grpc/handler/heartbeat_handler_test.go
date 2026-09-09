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

type mockHeartbeatNodeService struct {
	lastHeartbeat entity.NodeHeartbeatPayload
}

func (m *mockHeartbeatNodeService) ListNodes(ctx context.Context) ([]entity.ClusterNodeRecord, error) {
	return nil, nil
}
func (m *mockHeartbeatNodeService) GetNodeByID(ctx context.Context, id string) (*entity.ClusterNodeRecord, error) {
	return nil, nil
}
func (m *mockHeartbeatNodeService) GetNodeConfig(ctx context.Context, nodeID string) (string, error) {
	return "", nil
}
func (m *mockHeartbeatNodeService) RecordHeartbeat(ctx context.Context, p entity.NodeHeartbeatPayload) (*entity.NodeCommandDirective, error) {
	m.lastHeartbeat = p
	return &entity.NodeCommandDirective{Action: "none", DesiredReleaseID: 10, MetadataAcknowledged: true}, nil
}
func (m *mockHeartbeatNodeService) TriggerNodeReload(ctx context.Context, nodeID string) error {
	return nil
}
func (m *mockHeartbeatNodeService) TriggerRollingReload(ctx context.Context) (*entity.RollingStatus, error) {
	return nil, nil
}
func (m *mockHeartbeatNodeService) GetRollingStatus(ctx context.Context) (*entity.RollingStatus, error) {
	return nil, nil
}
func (m *mockHeartbeatNodeService) ListNodeSyncLogs(ctx context.Context, nodeID string, limit int) ([]entity.NodeSyncLogRecord, error) {
	return nil, nil
}
func (m *mockHeartbeatNodeService) SubscribeEvents() (<-chan entity.SSEMessage, func()) {
	return nil, func() {}
}

func TestHeartbeatHandler_Validation(t *testing.T) {
	nodeSvc := &mockHeartbeatNodeService{}
	h := handler.NewHeartbeatHandler(nodeSvc)
	ctx := context.Background()

	tests := []struct {
		name    string
		req     *pb.HeartbeatRequest
		wantErr codes.Code
	}{
		{
			name:    "nil request",
			req:     nil,
			wantErr: codes.InvalidArgument,
		},
		{
			name: "missing node_id",
			req: &pb.HeartbeatRequest{
				NodeId:    "",
				Timestamp: 1700000000,
			},
			wantErr: codes.InvalidArgument,
		},
		{
			name: "invalid timestamp",
			req: &pb.HeartbeatRequest{
				NodeId:    "node-01",
				Timestamp: 0,
			},
			wantErr: codes.InvalidArgument,
		},
		{
			name: "invalid digest length",
			req: &pb.HeartbeatRequest{
				NodeId:         "node-01",
				Timestamp:      1700000000,
				MetadataDigest: "too-short",
			},
			wantErr: codes.InvalidArgument,
		},
		{
			name: "invalid metadata master_pid",
			req: &pb.HeartbeatRequest{
				NodeId:    "node-01",
				Timestamp: 1700000000,
				Metadata: &pb.NginxMetadata{
					Version:   "1.25.0",
					MasterPid: 0,
				},
			},
			wantErr: codes.InvalidArgument,
		},
		{
			name: "invalid metadata empty version",
			req: &pb.HeartbeatRequest{
				NodeId:    "node-01",
				Timestamp: 1700000000,
				Metadata: &pb.NginxMetadata{
					Version:   "",
					MasterPid: 1234,
				},
			},
			wantErr: codes.InvalidArgument,
		},
		{
			name: "invalid health status enum",
			req: &pb.HeartbeatRequest{
				NodeId:    "node-01",
				Timestamp: 1700000000,
				Status:    pb.HealthStatus(999),
			},
			wantErr: codes.InvalidArgument,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := h.SendHeartbeat(ctx, tt.req)
			if err == nil {
				t.Fatalf("expected error code %v, got nil", tt.wantErr)
			}
			st, ok := status.FromError(err)
			if !ok || st.Code() != tt.wantErr {
				t.Fatalf("expected error code %v, got %v (err: %v)", tt.wantErr, st.Code(), err)
			}
		})
	}
}

func TestHeartbeatHandler_E2E(t *testing.T) {
	nodeSvc := &mockHeartbeatNodeService{}
	h := handler.NewHeartbeatHandler(nodeSvc)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer lis.Close()

	srv := grpc.NewServer()
	pb.RegisterHeartbeatServiceServer(srv, h)

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

	client := pb.NewHeartbeatServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req := &pb.HeartbeatRequest{
		NodeId:          "node-hb-e2e",
		Timestamp:       time.Now().Unix(),
		Status:          pb.HealthStatus_HEALTH_STATUS_SERVING,
		ActiveReleaseId: 5,
		MetadataDigest:  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		Metadata: &pb.NginxMetadata{
			Version:   "1.25.0",
			MasterPid: 1234,
		},
	}

	resp, err := client.SendHeartbeat(ctx, req)
	if err != nil {
		t.Fatalf("SendHeartbeat e2e failed: %v", err)
	}

	if resp.Action != "none" || resp.DesiredReleaseId != 10 || !resp.MetadataAcknowledged {
		t.Errorf("unexpected e2e response: %+v", resp)
	}

	if nodeSvc.lastHeartbeat.NodeID != "node-hb-e2e" {
		t.Errorf("expected node_id node-hb-e2e, got %s", nodeSvc.lastHeartbeat.NodeID)
	}
	if nodeSvc.lastHeartbeat.Status != "Ready" {
		t.Errorf("expected status Ready, got %s", nodeSvc.lastHeartbeat.Status)
	}
}
