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

// AccessSyncHandler phụ trách endpoint AccessSyncServiceServer.
type AccessSyncHandler struct {
	pb.UnimplementedAccessSyncServiceServer
	accessService port.AccessService
}

// NewAccessSyncHandler khởi tạo handler chỉ nhận dependency AccessService.
func NewAccessSyncHandler(accessService port.AccessService) *AccessSyncHandler {
	return &AccessSyncHandler{
		accessService: accessService,
	}
}

// GetAccess truy xuất cấu hình Access Control cho node sau khi validate input.
func (h *AccessSyncHandler) GetAccess(ctx context.Context, req *pb.GetAccessRequest) (*pb.AccessSyncResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	res, err := h.accessService.Desired(callCtx, entity.AccessSyncQuery{NodeID: req.NodeId})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "access sync timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to get access: %v", err)
	}

	return &pb.AccessSyncResponse{
		ReleaseId:   res.ReleaseID,
		Digest:      res.Digest,
		PayloadJson: string(res.Payload),
	}, nil
}

// ReportAccess ghi nhận trạng thái đồng bộ access từ node sau khi validate input.
func (h *AccessSyncHandler) ReportAccess(ctx context.Context, req *pb.ReportAccessRequest) (*pb.ReportAccessResponse, error) {
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

	cmd := entity.AccessReportCommand{
		NodeID:    req.NodeId,
		ReleaseID: req.ReleaseId,
		Phase:     req.Phase,
		Message:   req.Message,
	}

	if err := h.accessService.Report(callCtx, cmd); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "access report timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to report access status: %v", err)
	}

	return &pb.ReportAccessResponse{Success: true}, nil
}
