package grpc_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/config"
	grpcserver "github.com/phucle996/aurora-api-gateway/control-plane/internal/transport/grpc"
	"github.com/phucle996/aurora-api-gateway/control-plane/internal/transport/grpc/pb"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
)

func generateTestCertificates(t *testing.T, dir string) (caCertPath, serverCertPath, serverKeyPath, clientCertPath, clientKeyPath string) {
	t.Helper()

	// 1. Generate CA
	caPriv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate ca key: %v", err)
	}
	caTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "Test Aurora CA",
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
	}
	caBytes, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caPriv.PublicKey, caPriv)
	if err != nil {
		t.Fatalf("create ca cert: %v", err)
	}

	caCertPath = filepath.Join(dir, "ca.crt")
	caFile, _ := os.Create(caCertPath)
	_ = pem.Encode(caFile, &pem.Block{Type: "CERTIFICATE", Bytes: caBytes})
	_ = caFile.Close()

	// 2. Generate Server Cert
	serverPriv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate server key: %v", err)
	}
	serverTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject: pkix.Name{
			CommonName: "localhost",
		},
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:    []string{"localhost"},
		NotBefore:   time.Now().Add(-1 * time.Hour),
		NotAfter:    time.Now().Add(24 * time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	serverBytes, err := x509.CreateCertificate(rand.Reader, serverTemplate, caTemplate, &serverPriv.PublicKey, caPriv)
	if err != nil {
		t.Fatalf("create server cert: %v", err)
	}

	serverCertPath = filepath.Join(dir, "server.crt")
	serverKeyPath = filepath.Join(dir, "server.key")
	sCertFile, _ := os.Create(serverCertPath)
	_ = pem.Encode(sCertFile, &pem.Block{Type: "CERTIFICATE", Bytes: serverBytes})
	_ = sCertFile.Close()

	serverKeyBytes, _ := x509.MarshalECPrivateKey(serverPriv)
	sKeyFile, _ := os.Create(serverKeyPath)
	_ = pem.Encode(sKeyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: serverKeyBytes})
	_ = sKeyFile.Close()

	// 3. Generate Client Cert
	clientPriv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate client key: %v", err)
	}
	clientTemplate := &x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject: pkix.Name{
			CommonName: "agent-node-01",
		},
		DNSNames:    []string{"agent-node-01"},
		NotBefore:   time.Now().Add(-1 * time.Hour),
		NotAfter:    time.Now().Add(24 * time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	clientBytes, err := x509.CreateCertificate(rand.Reader, clientTemplate, caTemplate, &clientPriv.PublicKey, caPriv)
	if err != nil {
		t.Fatalf("create client cert: %v", err)
	}

	clientCertPath = filepath.Join(dir, "client.crt")
	clientKeyPath = filepath.Join(dir, "client.key")
	cCertFile, _ := os.Create(clientCertPath)
	_ = pem.Encode(cCertFile, &pem.Block{Type: "CERTIFICATE", Bytes: clientBytes})
	_ = cCertFile.Close()

	clientKeyBytes, _ := x509.MarshalECPrivateKey(clientPriv)
	cKeyFile, _ := os.Create(clientKeyPath)
	_ = pem.Encode(cKeyFile, &pem.Block{Type: "EC PRIVATE KEY", Bytes: clientKeyBytes})
	_ = cKeyFile.Close()

	return
}

func TestServer_Plaintext(t *testing.T) {
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen tcp: %v", err)
	}
	defer lis.Close()

	srv, err := grpcserver.NewServer(config.GRPCConfig{
		Addr:    lis.Addr().String(),
		TLSMode: "plaintext",
	}, "secret-token", grpcserver.Handlers{})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	defer srv.GracefulStop()

	go func() {
		_ = srv.Serve(lis)
	}()

	conn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	defer conn.Close()

	client := pb.NewSpecSyncServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer secret-token")
	_, err = client.SyncSpec(ctx, &pb.SyncSpecRequest{NodeId: "test-node"})
	if err != nil && err.Error() != "rpc error: code = Unimplemented desc = unknown service aurora.sync.v1.SpecSyncService" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestServer_TLS(t *testing.T) {
	dir := t.TempDir()
	caCertPath, serverCertPath, serverKeyPath, _, _ := generateTestCertificates(t, dir)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen tcp: %v", err)
	}
	defer lis.Close()

	srv, err := grpcserver.NewServer(config.GRPCConfig{
		Addr:     lis.Addr().String(),
		TLSMode:  "tls",
		CertFile: serverCertPath,
		KeyFile:  serverKeyPath,
	}, "secret-token", grpcserver.Handlers{})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	defer srv.GracefulStop()

	go func() {
		_ = srv.Serve(lis)
	}()

	// 1. Plaintext client should fail against TLS server
	plainConn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		client := pb.NewSpecSyncServiceClient(plainConn)
		_, err = client.SyncSpec(ctx, &pb.SyncSpecRequest{NodeId: "test-node"})
		if err == nil {
			t.Fatal("expected plaintext client to fail against TLS server, but it succeeded")
		}
		_ = plainConn.Close()
	}

	// 2. Client with CA cert should succeed
	caData, err := os.ReadFile(caCertPath)
	if err != nil {
		t.Fatalf("read ca: %v", err)
	}
	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM(caData)

	tlsCreds := credentials.NewTLS(&tls.Config{
		RootCAs:    caPool,
		ServerName: "localhost",
	})

	tlsConn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(tlsCreds))
	if err != nil {
		t.Fatalf("new tls client: %v", err)
	}
	defer tlsConn.Close()

	client := pb.NewSpecSyncServiceClient(tlsConn)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ctx = metadata.AppendToOutgoingContext(ctx, "authorization", "Bearer secret-token")
	_, err = client.SyncSpec(ctx, &pb.SyncSpecRequest{NodeId: "test-node"})
	if err != nil && err.Error() != "rpc error: code = Unimplemented desc = unknown service aurora.sync.v1.SpecSyncService" {
		t.Fatalf("unexpected error with valid TLS: %v", err)
	}
}

func TestServer_mTLS(t *testing.T) {
	dir := t.TempDir()
	caCertPath, serverCertPath, serverKeyPath, clientCertPath, clientKeyPath := generateTestCertificates(t, dir)

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen tcp: %v", err)
	}
	defer lis.Close()

	srv, err := grpcserver.NewServer(config.GRPCConfig{
		Addr:     lis.Addr().String(),
		TLSMode:  "mtls",
		CertFile: serverCertPath,
		KeyFile:  serverKeyPath,
		ClientCA: caCertPath,
	}, "secret-token", grpcserver.Handlers{})
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	defer srv.GracefulStop()

	go func() {
		_ = srv.Serve(lis)
	}()

	caData, _ := os.ReadFile(caCertPath)
	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM(caData)

	// 1. Client without client cert should fail handshake against mTLS server
	noCertCreds := credentials.NewTLS(&tls.Config{
		RootCAs:    caPool,
		ServerName: "localhost",
	})
	noCertConn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(noCertCreds))
	if err != nil {
		t.Fatalf("new client: %v", err)
	}
	ctx1, cancel1 := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel1()
	_, err = pb.NewSpecSyncServiceClient(noCertConn).SyncSpec(ctx1, &pb.SyncSpecRequest{NodeId: "test-node"})
	if err == nil {
		t.Fatal("expected client without certificate to fail against mTLS server, but it succeeded")
	}
	_ = noCertConn.Close()

	// 2. Client with client cert should succeed
	clientPair, err := tls.LoadX509KeyPair(clientCertPath, clientKeyPath)
	if err != nil {
		t.Fatalf("load client cert pair: %v", err)
	}

	mtlsCreds := credentials.NewTLS(&tls.Config{
		RootCAs:      caPool,
		Certificates: []tls.Certificate{clientPair},
		ServerName:   "localhost",
	})
	mtlsConn, err := grpc.NewClient(lis.Addr().String(), grpc.WithTransportCredentials(mtlsCreds))
	if err != nil {
		t.Fatalf("new mtls client: %v", err)
	}
	defer mtlsConn.Close()

	ctx2, cancel2 := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel2()
	ctx2 = metadata.AppendToOutgoingContext(ctx2, "authorization", "Bearer secret-token")
	_, err = pb.NewSpecSyncServiceClient(mtlsConn).SyncSpec(ctx2, &pb.SyncSpecRequest{NodeId: "test-node"})
	if err != nil && err.Error() != "rpc error: code = Unimplemented desc = unknown service aurora.sync.v1.SpecSyncService" {
		t.Fatalf("unexpected error with valid mTLS: %v", err)
	}
}
