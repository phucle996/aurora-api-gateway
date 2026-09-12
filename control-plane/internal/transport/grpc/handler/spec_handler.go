package handler

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type SpecSyncHandler struct {
	pb.UnimplementedSpecSyncServiceServer
	specService port.SpecSyncService
}

func NewSpecSyncHandler(specService port.SpecSyncService) *SpecSyncHandler {
	return &SpecSyncHandler{
		specService: specService,
	}
}

func (h *SpecSyncHandler) SyncSpec(ctx context.Context, req *pb.SyncSpecRequest) (*pb.SyncSpecResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}

	res, err := h.specService.SyncSpec(ctx, entity.SpecSyncQuery{
		NodeID:      req.NodeId,
		CurrentHash: req.CurrentHash,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to sync spec: %v", err)
	}

	return &pb.SyncSpecResponse{
		InSync:    res.InSync,
		ReleaseId: res.ReleaseID,
		Hash:      res.Hash,
		SpecJson:  res.SpecJSON,
	}, nil
}

func (h *SpecSyncHandler) ReportSpec(ctx context.Context, req *pb.ReportSpecRequest) (*pb.ReportSpecResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}

	err := h.specService.ReportSpec(ctx, entity.SpecReportCommand{
		NodeID:    req.NodeId,
		ReleaseID: req.ReleaseId,
		Hash:      req.Hash,
		Status:    req.Status,
		Message:   req.Message,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to report spec: %v", err)
	}

	return &pb.ReportSpecResponse{
		Success: true,
	}, nil
}
