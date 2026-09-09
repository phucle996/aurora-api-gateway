package grpc

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"strings"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

// AuthInterceptor verifies incoming Bearer tokens from gRPC metadata.
func AuthInterceptor(token string) grpc.UnaryServerInterceptor {
	expected := sha256.Sum256([]byte("Bearer " + token))

	return func(
		ctx context.Context,
		req any,
		info *grpc.UnaryServerInfo,
		handler grpc.UnaryHandler,
	) (any, error) {
		// If no admin token configured on server, allow request (development mode)
		if token == "" {
			return handler(ctx, req)
		}

		md, ok := metadata.FromIncomingContext(ctx)
		if !ok {
			return nil, status.Error(codes.Unauthenticated, "missing metadata")
		}

		authHeaders := md.Get("authorization")
		if len(authHeaders) == 0 {
			return nil, status.Error(codes.Unauthenticated, "missing authorization token")
		}

		authVal := strings.TrimSpace(authHeaders[0])
		actual := sha256.Sum256([]byte(authVal))

		if subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
			return nil, status.Error(codes.PermissionDenied, "invalid authorization token")
		}

		return handler(ctx, req)
	}
}
