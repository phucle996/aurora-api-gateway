package service_test

import (
	"context"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/service"
)

type mockDomainRepo struct {
	lastQuery entity.ListDomainsQuery
}

func (m *mockDomainRepo) ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error) {
	m.lastQuery = q
	return entity.ListDomainsResult{
		Items: []entity.ListDomainsItem{
			{ID: 1, Domain: "test.example.com", Status: "Active"},
		},
		Counts:        entity.ListDomainsCounts{Total: 1, Active: 1},
		TotalFiltered: 1,
	}, nil
}

func TestDomainService_ListDomains(t *testing.T) {
	mockRepo := &mockDomainRepo{}
	svc := service.NewDomainService(mockRepo)
	ctx := context.Background()

	t.Run("Passes query directly to repository", func(t *testing.T) {
		inputQuery := entity.ListDomainsQuery{
			Search:  "api",
			Status:  "Active",
			TLSType: "Let's Encrypt",
			Tag:     "prod",
			Limit:   20,
			Offset:  10,
		}

		res, err := svc.ListDomains(ctx, inputQuery)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if mockRepo.lastQuery != inputQuery {
			t.Errorf("expected query passed directly %+v, got %+v", inputQuery, mockRepo.lastQuery)
		}
		if len(res.Items) != 1 {
			t.Errorf("expected 1 item, got %d", len(res.Items))
		}
	})
}
