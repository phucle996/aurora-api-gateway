package handler

import (
	"context"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
	port "github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/service"
	"github.com/phucle996/aurora-api-gateway/control-plane/internal/transport/grpc/pb"
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
