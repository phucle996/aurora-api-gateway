package service_test

import (
	"context"
	"errors"
	"testing"

	"aurora-waf.local/control-plane/internal/service"
)

type mockStorageRepo struct {
	checkErr error
}

func (m *mockStorageRepo) Check(ctx context.Context) error {
	return m.checkErr
}

func TestHealthcheckServiceStatus(t *testing.T) {
	svc := service.NewHealthcheckService(&mockStorageRepo{})
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
	svcSuccess := service.NewHealthcheckService(&mockStorageRepo{checkErr: nil})
	if err := svcSuccess.Ready(context.Background()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}

	// Failure case
	expectedErr := errors.New("db connection lost")
	svcFail := service.NewHealthcheckService(&mockStorageRepo{checkErr: expectedErr})
	if err := svcFail.Ready(context.Background()); !errors.Is(err, expectedErr) {
		t.Fatalf("expected %v, got %v", expectedErr, err)
	}
}
