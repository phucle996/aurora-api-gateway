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

// DomainRoutingSyncHandler phụ trách endpoint DomainRoutingSyncServiceServer.
type DomainRoutingSyncHandler struct {
	pb.UnimplementedDomainRoutingSyncServiceServer
	routingService port.DomainRoutingService
}

// NewDomainRoutingSyncHandler khởi tạo handler chỉ nhận dependency DomainRoutingService.
func NewDomainRoutingSyncHandler(routingService port.DomainRoutingService) *DomainRoutingSyncHandler {
	return &DomainRoutingSyncHandler{
		routingService: routingService,
	}
}

// GetDomainRoutingBundle trả về cấu hình domain routing và chứng chỉ TLS bundle sau khi validate input.
func (h *DomainRoutingSyncHandler) GetDomainRoutingBundle(ctx context.Context, req *pb.GetDomainRoutingBundleRequest) (*pb.DomainRoutingBundleResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	res, err := h.routingService.DesiredRouting(callCtx, entity.DomainRoutingQuery{NodeID: req.NodeId})
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "domain routing snapshot timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to get domain routing: %v", err)
	}

	files := make([]*pb.CertificateAsset, len(res.Files))
	for i, f := range res.Files {
		files[i] = &pb.CertificateAsset{
			Name:    f.Name,
			Content: string(f.Content),
		}
	}

	return &pb.DomainRoutingBundleResponse{
		Config: res.Config,
		Digest: res.Digest,
		Files:  files,
	}, nil
}
