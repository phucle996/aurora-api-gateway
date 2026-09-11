package service_test

import (
	"context"
	"errors"
	"testing"

	"aurora-waf.local/control-plane/internal/service"
)

type mockHealthcheckSystemRepo struct {
	checkErr error
}

func (m *mockHealthcheckSystemRepo) Check(ctx context.Context) error {
	return m.checkErr
}

func (m *mockHealthcheckSystemRepo) GetNodeCounts(ctx context.Context) (int, int, error) {
	return 0, 0, nil
}

func TestHealthcheckServiceStatus(t *testing.T) {
	svc := service.NewHealthcheckService(&mockHealthcheckSystemRepo{})
	status := svc.Status()
	if status.Component != "aurora-controller" {
		t.Fatalf("expected component 'aurora-controller', got %s", status.Component)
	}
	if status.Stage != "foundation" {
		t.Fatalf("expected stage 'foundation', got %s", status.Stage)
	}
}

func TestHealthcheckServiceReady(t *testing.T) {
	// Success case
	svcSuccess := service.NewHealthcheckService(&mockHealthcheckSystemRepo{checkErr: nil})
	if err := svcSuccess.Ready(context.Background()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	// Failure case
	expectedErr := errors.New("db connection lost")
	svcFail := service.NewHealthcheckService(&mockHealthcheckSystemRepo{checkErr: expectedErr})
	if err := svcFail.Ready(context.Background()); !errors.Is(err, expectedErr) {
		t.Fatalf("expected %v, got %v", expectedErr, err)
	}
}
