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

func (m *mockDomainRepo) DomainCatalog(ctx context.Context) ([]entity.DomainCatalogItem, error) {
	return []entity.DomainCatalogItem{
		{ID: 1, Domain: "test.example.com", RootDomain: "example.com", Status: "Active", Upstream: "prod-be"},
	}, nil
}

func (m *mockDomainRepo) Create(ctx context.Context, cmd entity.CreateDomainCommand) (int64, error) {
	return 1, nil
}

func (m *mockDomainRepo) GetByID(ctx context.Context, id int64) (*entity.ListDomainsItem, error) {
	return &entity.ListDomainsItem{
		ID:         id,
		Domain:     "test.example.com",
		RootDomain: "example.com",
		Status:     "Active",
		Upstream:   "http://127.0.0.1:8080",
	}, nil
}

func (m *mockDomainRepo) Update(ctx context.Context, id int64, cmd entity.UpdateDomainCommand) error {
	return nil
}

func (m *mockDomainRepo) Delete(ctx context.Context, id int64) error {
	return nil
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

	t.Run("Returns domain catalog directly from repository", func(t *testing.T) {
		items, err := svc.DomainCatalog(ctx)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(items) != 1 || items[0].Domain != "test.example.com" {
			t.Errorf("expected catalog item with test.example.com, got %+v", items)
		}
	})

	t.Run("CreateDomain validates input and creates domain", func(t *testing.T) {
		_, err := svc.CreateDomain(ctx, entity.CreateDomainCommand{
			Domain:   "",
			Upstream: "http://127.0.0.1:8080",
		})
		if err == nil {
			t.Errorf("expected error for empty domain")
		}

		item, err := svc.CreateDomain(ctx, entity.CreateDomainCommand{
			Domain:   "test.example.com",
			Upstream: "http://127.0.0.1:8080",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.Domain != "test.example.com" {
			t.Errorf("expected domain test.example.com, got %s", item.Domain)
		}
	})

	t.Run("GetDomain returns domain by id", func(t *testing.T) {
		item, err := svc.GetDomain(ctx, 1)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item.ID != 1 {
			t.Errorf("expected id 1, got %d", item.ID)
		}
	})

	t.Run("UpdateDomain updates domain", func(t *testing.T) {
		item, err := svc.UpdateDomain(ctx, 1, entity.UpdateDomainCommand{
			Upstream: "http://127.0.0.1:9090",
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if item == nil {
			t.Errorf("expected updated item, got nil")
		}
	})

	t.Run("DeleteDomain deletes domain", func(t *testing.T) {
		err := svc.DeleteDomain(ctx, 1)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}
