package grpc

import (
	"net"

	"aurora-waf.local/control-plane/internal/transport/grpc/handler"
	"aurora-waf.local/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

type Server struct {
	grpcServer *grpc.Server
	addr       string
}

type Handlers struct {
	Heartbeat     *handler.HeartbeatHandler
	Policy        *handler.PolicySyncHandler
	Access        *handler.AccessSyncHandler
	Upstream      *handler.UpstreamSyncHandler
	DomainRouting *handler.DomainRoutingSyncHandler
	Module        *handler.ModuleSyncHandler
}

func NewServer(addr string, adminToken string, handlers Handlers) *Server {
	opts := []grpc.ServerOption{
		grpc.UnaryInterceptor(AuthInterceptor(adminToken)),
	}

	s := grpc.NewServer(opts...)
	if handlers.Heartbeat != nil {
		pb.RegisterHeartbeatServiceServer(s, handlers.Heartbeat)
	}
	if handlers.Policy != nil {
		pb.RegisterPolicySyncServiceServer(s, handlers.Policy)
	}
	if handlers.Access != nil {
		pb.RegisterAccessSyncServiceServer(s, handlers.Access)
	}
	if handlers.Upstream != nil {
		pb.RegisterUpstreamSyncServiceServer(s, handlers.Upstream)
	}
	if handlers.DomainRouting != nil {
		pb.RegisterDomainRoutingSyncServiceServer(s, handlers.DomainRouting)
	}
	if handlers.Module != nil {
		pb.RegisterModuleSyncServiceServer(s, handlers.Module)
	}
	reflection.Register(s)

	return &Server{
		grpcServer: s,
		addr:       addr,
	}
}

func (s *Server) Addr() string {
	return s.addr
}

func (s *Server) Serve(lis net.Listener) error {
	return s.grpcServer.Serve(lis)
}

func (s *Server) GracefulStop() {
	s.grpcServer.GracefulStop()
}

func (s *Server) Stop() {
	s.grpcServer.Stop()
}
