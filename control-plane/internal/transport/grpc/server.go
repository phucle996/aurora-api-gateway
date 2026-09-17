package grpc

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"strings"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/config"
	"github.com/phucle996/aurora-api-gateway/control-plane/internal/transport/grpc/handler"
	"github.com/phucle996/aurora-api-gateway/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/reflection"
)

type Server struct {
	grpcServer *grpc.Server
	addr       string
}

type Handlers struct {
	Spec *handler.SpecSyncHandler
}

func NewServer(cfg config.GRPCConfig, adminToken string, handlers Handlers) (*Server, error) {
	opts := []grpc.ServerOption{
		grpc.UnaryInterceptor(AuthInterceptor(adminToken)),
	}

	mode := strings.ToLower(strings.TrimSpace(cfg.TLSMode))
	switch mode {
	case "", "plaintext":
		// Plaintext TCP, no TLS credentials required

	case "tls":
		cert, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("load server TLS key pair: %w", err)
		}
		tlsConfig := &tls.Config{
			Certificates: []tls.Certificate{cert},
			MinVersion:   tls.VersionTLS12,
		}
		opts = append(opts, grpc.Creds(credentials.NewTLS(tlsConfig)))

	case "mtls":
		cert, err := tls.LoadX509KeyPair(cfg.CertFile, cfg.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("load server TLS key pair: %w", err)
		}

		caData, err := os.ReadFile(cfg.ClientCA)
		if err != nil {
			return nil, fmt.Errorf("read client CA certificate: %w", err)
		}

		clientCAPool := x509.NewCertPool()
		if !clientCAPool.AppendCertsFromPEM(caData) {
			return nil, fmt.Errorf("failed to parse client CA certificates from %s", cfg.ClientCA)
		}

		tlsConfig := &tls.Config{
			Certificates: []tls.Certificate{cert},
			ClientCAs:    clientCAPool,
			ClientAuth:   tls.RequireAndVerifyClientCert,
			MinVersion:   tls.VersionTLS12,
		}
		opts = append(opts, grpc.Creds(credentials.NewTLS(tlsConfig)))

	default:
		return nil, fmt.Errorf("unsupported gRPC TLS mode %q (must be plaintext, tls, or mtls)", cfg.TLSMode)
	}

	s := grpc.NewServer(opts...)
	if handlers.Spec != nil {
		pb.RegisterSpecSyncServiceServer(s, handlers.Spec)
	}
	reflection.Register(s)

	return &Server{
		grpcServer: s,
		addr:       cfg.Addr,
	}, nil
}

func (s *Server) Serve(lis net.Listener) error {
	return s.grpcServer.Serve(lis)
}

func (s *Server) GracefulStop() {
	s.grpcServer.GracefulStop()
}
