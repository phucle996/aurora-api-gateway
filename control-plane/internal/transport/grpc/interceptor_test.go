package grpc_test

import (
	"context"
	"testing"

	grpcserver "aurora-waf.local/control-plane/internal/transport/grpc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestAuthInterceptor(t *testing.T) {
	interceptor := grpcserver.AuthInterceptor("secret-token-12345678901234567890")

	handlerCalled := false
	dummyHandler := func(ctx context.Context, req any) (any, error) {
		handlerCalled = true
		return "ok", nil
	}

	// 1. Missing metadata -> unauthenticated
	_, err := interceptor(context.Background(), nil, &grpc.UnaryServerInfo{}, dummyHandler)
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("expected Unauthenticated, got %v", err)
	}

	// 2. Missing authorization header -> unauthenticated
	md := metadata.Pairs("other-header", "val")
	ctx := metadata.NewIncomingContext(context.Background(), md)
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{}, dummyHandler)
	if status.Code(err) != codes.Unauthenticated {
		t.Errorf("expected Unauthenticated, got %v", err)
	}

	// 3. Invalid token -> permission denied
	md = metadata.Pairs("authorization", "Bearer wrong-token")
	ctx = metadata.NewIncomingContext(context.Background(), md)
	_, err = interceptor(ctx, nil, &grpc.UnaryServerInfo{}, dummyHandler)
	if status.Code(err) != codes.PermissionDenied {
		t.Errorf("expected PermissionDenied, got %v", err)
	}

	// 4. Valid token -> success
	md = metadata.Pairs("authorization", "Bearer secret-token-12345678901234567890")
	ctx = metadata.NewIncomingContext(context.Background(), md)
	resp, err := interceptor(ctx, nil, &grpc.UnaryServerInfo{}, dummyHandler)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !handlerCalled || resp != "ok" {
		t.Errorf("expected handler called with ok, got %v", resp)
	}
}
