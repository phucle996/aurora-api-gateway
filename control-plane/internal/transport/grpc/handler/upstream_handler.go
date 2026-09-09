package handler

import (
	"context"
	"errors"

	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// UpstreamSyncHandler phụ trách endpoint UpstreamSyncServiceServer.
type UpstreamSyncHandler struct {
	pb.UnimplementedUpstreamSyncServiceServer
	upstreamService port.UpstreamService
}

// NewUpstreamSyncHandler khởi tạo handler chỉ nhận dependency UpstreamService.
func NewUpstreamSyncHandler(upstreamService port.UpstreamService) *UpstreamSyncHandler {
	return &UpstreamSyncHandler{
		upstreamService: upstreamService,
	}
}

// GetUpstreams truy xuất cấu hình Upstreams cho node sau khi validate input.
func (h *UpstreamSyncHandler) GetUpstreams(ctx context.Context, req *pb.GetUpstreamsRequest) (*pb.UpstreamSyncResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	snapshot, err := h.upstreamService.GetDesiredSnapshot(callCtx, req.NodeId)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "upstream snapshot timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to get upstreams: %v", err)
	}

	return &pb.UpstreamSyncResponse{
		ReleaseId:     snapshot.ReleaseID,
		Digest:        snapshot.Digest,
		ConfigContent: snapshot.ConfigContent,
	}, nil
}

// ReportUpstreams ghi nhận trạng thái đồng bộ upstream từ node sau khi validate input.
func (h *UpstreamSyncHandler) ReportUpstreams(ctx context.Context, req *pb.ReportUpstreamsRequest) (*pb.ReportUpstreamsResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}
	if req.ReleaseId <= 0 {
		return nil, status.Error(codes.InvalidArgument, "release_id must be positive")
	}
	if req.Phase != "applied" && req.Phase != "failed" {
		return nil, status.Error(codes.InvalidArgument, "phase must be 'applied' or 'failed'")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	if err := h.upstreamService.ReportSyncStatus(callCtx, req.NodeId, req.ReleaseId, req.Phase, req.Message); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "upstream report timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to report upstream status: %v", err)
	}

	return &pb.ReportUpstreamsResponse{Success: true}, nil
}
