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

type mockModuleSyncService struct {
	lastAppend entity.AppendModuleJobLogCommand
	lastReport entity.ReportModuleCommand
}

func (m *mockModuleSyncService) List(ctx context.Context, q entity.ListModulesQuery) ([]entity.ModuleStoreNode, error) {
	return nil, nil
}
func (m *mockModuleSyncService) Queue(ctx context.Context, c entity.QueueModuleJobCommand) (entity.QueueModuleJobResult, error) {
	return entity.QueueModuleJobResult{}, nil
}
func (m *mockModuleSyncService) Poll(ctx context.Context, q entity.PollModuleJobQuery) (entity.PollModuleJobResult, error) {
	return entity.PollModuleJobResult{ID: 101, Action: "install_brotli"}, nil
}
func (m *mockModuleSyncService) Report(ctx context.Context, c entity.ReportModuleCommand) error {
	m.lastReport = c
	return nil
}
func (m *mockModuleSyncService) GetJobLogs(ctx context.Context, q entity.ModuleJobLogsQuery) (*entity.ModuleJobLogs, error) {
	return nil, nil
}
func (m *mockModuleSyncService) AppendJobLog(ctx context.Context, c entity.AppendModuleJobLogCommand) error {
	m.lastAppend = c
	return nil
}
func (m *mockModuleSyncService) SubscribeJobEvents() (<-chan entity.SSEMessage, func()) {
	return nil, func() {}
}
func (m *mockModuleSyncService) GetSyncOverview(ctx context.Context, q entity.GetModuleSyncOverviewQuery) ([]entity.ModuleSyncItem, error) {
	return nil, nil
}
func (m *mockModuleSyncService) SetDesiredState(ctx context.Context, c entity.SetModuleDesiredCommand) error {
	return nil
}
func (m *mockModuleSyncService) Sync(ctx context.Context, c entity.TriggerModuleSyncCommand) (entity.TriggerModuleSyncResult, error) {
	return entity.TriggerModuleSyncResult{}, nil
}

func TestModuleSyncHandler_Validation(t *testing.T) {
	svc := &mockModuleSyncService{}
	h := handler.NewModuleSyncHandler(svc)
	ctx := context.Background()

	t.Run("PollModuleJob validation", func(t *testing.T) {
		_, err := h.PollModuleJob(ctx, nil)
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.PollModuleJob(ctx, &pb.PollModuleJobRequest{NodeId: ""})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})

	t.Run("AppendModuleJobLog validation", func(t *testing.T) {
		_, err := h.AppendModuleJobLog(ctx, nil)
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.AppendModuleJobLog(ctx, &pb.AppendModuleJobLogRequest{NodeId: "", JobId: 1, Stage: "init", Progress: 10})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.AppendModuleJobLog(ctx, &pb.AppendModuleJobLogRequest{NodeId: "node-01", JobId: 0, Stage: "init", Progress: 10})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.AppendModuleJobLog(ctx, &pb.AppendModuleJobLogRequest{NodeId: "node-01", JobId: 1, Stage: "init", Progress: 101})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.AppendModuleJobLog(ctx, &pb.AppendModuleJobLogRequest{NodeId: "node-01", JobId: 1, Stage: "", Progress: 50})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})

	t.Run("ReportModules validation", func(t *testing.T) {
		_, err := h.ReportModules(ctx, nil)
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.ReportModules(ctx, &pb.ModuleReportRequest{NodeId: "", CheckedAt: 100, NginxVersion: "1.25.0"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.ReportModules(ctx, &pb.ModuleReportRequest{NodeId: "node-01", CheckedAt: 0, NginxVersion: "1.25.0"})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
		_, err = h.ReportModules(ctx, &pb.ModuleReportRequest{NodeId: "node-01", CheckedAt: 100, NginxVersion: ""})
		if st, _ := status.FromError(err); st.Code() != codes.InvalidArgument {
			t.Fatalf("expected InvalidArgument, got %v", st.Code())
		}
	})
}

func TestModuleSyncHandler_E2E(t *testing.T) {
	svc := &mockModuleSyncService{}
	h := handler.NewModuleSyncHandler(svc)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("failed to listen: %v", err)
	}
	defer lis.Close()

	srv := grpc.NewServer()
	pb.RegisterModuleSyncServiceServer(srv, h)

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

	client := pb.NewModuleSyncServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// 1. PollModuleJob
	pollResp, err := client.PollModuleJob(ctx, &pb.PollModuleJobRequest{NodeId: "node-module-e2e"})
	if err != nil {
		t.Fatalf("PollModuleJob e2e failed: %v", err)
	}
	if pollResp.Id != 101 || pollResp.Action != "install_brotli" {
		t.Fatalf("unexpected poll response: %+v", pollResp)
	}

	// 2. AppendModuleJobLog
	appendResp, err := client.AppendModuleJobLog(ctx, &pb.AppendModuleJobLogRequest{
		NodeId:   "node-module-e2e",
		JobId:    101,
		Stage:    "compile",
		Progress: 75,
		Message:  "compiling module",
		LogChunk: "make -j4",
	})
	if err != nil || !appendResp.Success {
		t.Fatalf("AppendModuleJobLog e2e failed: %v, resp: %+v", err, appendResp)
	}
	if svc.lastAppend.NodeID != "node-module-e2e" || svc.lastAppend.JobID != 101 || svc.lastAppend.Progress != 75 {
		t.Fatalf("unexpected append state: %+v", svc.lastAppend)
	}

	// 3. ReportModules
	repResp, err := client.ReportModules(ctx, &pb.ModuleReportRequest{
		NodeId:       "node-module-e2e",
		CheckedAt:    time.Now().Unix(),
		NginxVersion: "1.25.0",
		Modules: []*pb.ModuleReportItem{
			{Name: "ngx_http_waf_module", Available: true, Loaded: true, Source: "native"},
		},
	})
	if err != nil || !repResp.Success {
		t.Fatalf("ReportModules e2e failed: %v, resp: %+v", err, repResp)
	}
	if svc.lastReport.NodeID != "node-module-e2e" || svc.lastReport.NginxVersion != "1.25.0" || len(svc.lastReport.Modules) != 1 {
		t.Fatalf("unexpected report state: %+v", svc.lastReport)
	}
}
