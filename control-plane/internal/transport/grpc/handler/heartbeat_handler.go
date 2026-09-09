package handler

import (
	"context"
	"errors"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/peer"
	"google.golang.org/grpc/status"
)

const defaultRPCTimeout = 5 * time.Second

// HeartbeatHandler phụ trách endpoint HeartbeatServiceServer.
type HeartbeatHandler struct {
	pb.UnimplementedHeartbeatServiceServer
	nodeService port.NodeService
}

// NewHeartbeatHandler khởi tạo handler chỉ nhận dependency NodeService.
func NewHeartbeatHandler(nodeService port.NodeService) *HeartbeatHandler {
	return &HeartbeatHandler{
		nodeService: nodeService,
	}
}

// SendHeartbeat nhận telemetry heartbeat từ Agent, validate input tại handler và gọi service.
func (h *HeartbeatHandler) SendHeartbeat(ctx context.Context, req *pb.HeartbeatRequest) (*pb.HeartbeatResponse, error) {
	if req == nil {
		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
	}
	if req.NodeId == "" {
		return nil, status.Error(codes.InvalidArgument, "node_id is required")
	}
	if req.Timestamp <= 0 || req.Timestamp > time.Now().Unix()+60 {
		return nil, status.Error(codes.InvalidArgument, "invalid heartbeat timestamp: must be positive and not skewed in the future")
	}
	if req.MetadataDigest != "" && len(req.MetadataDigest) != 64 {
		return nil, status.Error(codes.InvalidArgument, "metadata_digest must be a 64-character hex string")
	}

	clientIP := ""
	if p, ok := peer.FromContext(ctx); ok && p.Addr != nil {
		clientIP = p.Addr.String()
	}

	statusStr := "Ready"
	switch req.Status {
	case pb.HealthStatus_HEALTH_STATUS_SERVING, pb.HealthStatus_HEALTH_STATUS_UNKNOWN:
		statusStr = "Ready"
	case pb.HealthStatus_HEALTH_STATUS_DEGRADED:
		statusStr = "Degraded"
	case pb.HealthStatus_HEALTH_STATUS_DOWN:
		statusStr = "Offline"
	default:
		return nil, status.Errorf(codes.InvalidArgument, "unknown health status: %v", req.Status)
	}

	var meta *entity.NginxMetadata
	if req.Metadata != nil {
		if req.Metadata.Version == "" {
			return nil, status.Error(codes.InvalidArgument, "metadata.version cannot be empty when metadata is provided")
		}
		if req.Metadata.MasterPid <= 0 {
			return nil, status.Error(codes.InvalidArgument, "metadata.master_pid must be positive")
		}

		meta = &entity.NginxMetadata{
			Version:          req.Metadata.Version,
			MasterPID:        req.Metadata.MasterPid,
			WorkerCount:      req.Metadata.WorkerCount,
			ActiveReleaseID:  req.Metadata.ActiveReleaseId,
			RuntimeStartedAt: req.Metadata.RuntimeStartedAt,
			Hostname:         req.Metadata.Hostname,
			Role:             req.Metadata.Role,
			WorkerIdentity:   req.Metadata.WorkerIdentity,
		}
	}

	payload := entity.NodeHeartbeatPayload{
		NodeID:          req.NodeId,
		Timestamp:       req.Timestamp,
		ActiveReleaseID: req.ActiveReleaseId,
		Status:          statusStr,
		MetadataDigest:  req.MetadataDigest,
		Metadata:        meta,
		IP:              clientIP,
		Authentication:  "Bearer / gRPC",
	}
	if meta != nil {
		payload.Version = meta.Version
		payload.Hostname = meta.Hostname
		payload.RuntimeStartedAt = meta.RuntimeStartedAt
		payload.WorkerIdentity = meta.WorkerIdentity
	}

	callCtx, cancel := context.WithTimeout(ctx, defaultRPCTimeout)
	defer cancel()

	directive, err := h.nodeService.RecordHeartbeat(callCtx, payload)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, status.Error(codes.DeadlineExceeded, "heartbeat recording timed out")
		}
		return nil, status.Errorf(codes.Internal, "failed to record heartbeat: %v", err)
	}

	return &pb.HeartbeatResponse{
		Action:               directive.Action,
		DesiredReleaseId:     directive.DesiredReleaseID,
		MetadataAcknowledged: directive.MetadataAcknowledged,
	}, nil
}
