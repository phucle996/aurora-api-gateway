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

// PolicySyncHandler phụ trách endpoint PolicySyncServiceServer.
type PolicySyncHandler struct {
	pb.UnimplementedPolicySyncServiceServer
	policyService port.PolicyService
}

// NewPolicySyncHandler khởi tạo handler chỉ nhận dependency PolicyService.
func NewPolicySyncHandler(policyService port.PolicyService) *PolicySyncHandler {
	return &PolicySyncHandler{
		policyService: policyService,
	}
}

// GetPolicy truy xuất WAF policy cho node sau khi validate input.
func (h *PolicySyncHandler) GetPolicy(ctx context.Context, req *pb.GetPolicyRequest) (*pb.PolicySyncResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	res, err := h.policyService.PolicySync(callCtx, entity.PolicySyncQuery{NodeID: req.NodeId})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "policy sync timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to get policy: %v", err)
	}

	return &pb.PolicySyncResponse{
		ReleaseId:   res.ReleaseID,
		Digest:      res.Digest,
		PayloadJson: string(res.Payload),
	}, nil
}

// ReportPolicy ghi nhận trạng thái đồng bộ policy từ node sau khi validate input.
func (h *PolicySyncHandler) ReportPolicy(ctx context.Context, req *pb.ReportPolicyRequest) (*pb.ReportPolicyResponse, error) {
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

	cmd := entity.PolicyReportCommand{
		NodeID:    req.NodeId,
		ReleaseID: req.ReleaseId,
		Phase:     req.Phase,
		Message:   req.Message,
	}

	if err := h.policyService.PolicyReport(callCtx, cmd); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "policy report timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to report policy status: %v", err)
	}

	return &pb.ReportPolicyResponse{Success: true}, nil
}
