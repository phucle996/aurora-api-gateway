package handler

import (
	"context"
	"errors"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ModuleSyncHandler phụ trách endpoint ModuleSyncServiceServer.
type ModuleSyncHandler struct {
	pb.UnimplementedModuleSyncServiceServer
	moduleService port.ModuleStoreService
}

// NewModuleSyncHandler khởi tạo handler chỉ nhận dependency ModuleStoreService.
func NewModuleSyncHandler(moduleService port.ModuleStoreService) *ModuleSyncHandler {
	return &ModuleSyncHandler{
		moduleService: moduleService,
	}
}

// PollModuleJob kiểm tra job module đang chờ xử lý cho node sau khi validate input.
func (h *ModuleSyncHandler) PollModuleJob(ctx context.Context, req *pb.PollModuleJobRequest) (*pb.PollModuleJobResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	res, err := h.moduleService.Poll(callCtx, entity.PollModuleJobQuery{NodeID: req.NodeId})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "poll module job timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to poll module job: %v", err)
	}

	return &pb.PollModuleJobResponse{
		Id:     res.ID,
		Action: res.Action,
	}, nil
}

// AppendModuleJobLog ghi nhận log thực thi của job module sau khi validate input.
func (h *ModuleSyncHandler) AppendModuleJobLog(ctx context.Context, req *pb.AppendModuleJobLogRequest) (*pb.AppendModuleJobLogResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}
	if req.JobId <= 0 {
		return nil, status.Error(codes.InvalidArgument, "job_id must be positive")
	}
	if req.Progress < 0 || req.Progress > 100 {
		return nil, status.Error(codes.InvalidArgument, "progress must be between 0 and 100")
	}
	if req.Stage == "" {
		return nil, status.Error(codes.InvalidArgument, "stage is required")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	cmd := entity.AppendModuleJobLogCommand{
		NodeID:   req.NodeId,
		JobID:    req.JobId,
		Stage:    req.Stage,
		Progress: int(req.Progress),
		Message:  req.Message,
		LogChunk: req.LogChunk,
	}

	if err := h.moduleService.AppendJobLog(callCtx, cmd); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "append job log timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to append job log: %v", err)
	}

	return &pb.AppendModuleJobLogResponse{Success: true}, nil
}

// ReportModules báo cáo danh sách và trạng thái các module NGINX sau khi validate input.
func (h *ModuleSyncHandler) ReportModules(ctx context.Context, req *pb.ModuleReportRequest) (*pb.ModuleReportResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}
	if req.CheckedAt <= 0 {
		return nil, status.Error(codes.InvalidArgument, "checked_at must be positive unix timestamp")
	}
	if req.NginxVersion == "" {
		return nil, status.Error(codes.InvalidArgument, "nginx_version is required")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	mods := make([]entity.ReportModuleItem, len(req.Modules))
	for i, m := range req.Modules {
		mods[i] = entity.ReportModuleItem{
			Name:      m.Name,
			Available: m.Available,
			Loaded:    m.Loaded,
			Source:    m.Source,
		}
	}

	cmd := entity.ReportModuleCommand{
		NodeID:       req.NodeId,
		CheckedAt:    req.CheckedAt,
		NginxVersion: req.NginxVersion,
		Architecture: req.Architecture,
		Installable:  req.Installable,
		Error:        req.Error,
		JobID:        req.JobId,
		JobState:     req.JobState,
		JobMessage:   req.JobMessage,
		JobLogs:      req.JobLogs,
		Modules:      mods,
	}

	if err := h.moduleService.Report(callCtx, cmd); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "report modules timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to report modules: %v", err)
	}

	return &pb.ModuleReportResponse{Success: true}, nil
}
