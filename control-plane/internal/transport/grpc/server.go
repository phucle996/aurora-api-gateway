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
	Spec *handler.SpecSyncHandler
}

func NewServer(addr string, adminToken string, handlers Handlers) *Server {
	opts := []grpc.ServerOption{
		grpc.UnaryInterceptor(AuthInterceptor(adminToken)),
	}

	s := grpc.NewServer(opts...)
	if handlers.Spec != nil {
		pb.RegisterSpecSyncServiceServer(s, handlers.Spec)
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
