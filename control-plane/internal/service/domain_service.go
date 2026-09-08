package service

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
)

type DomainService struct {
	repo repo.DomainRepository
}

func NewDomainService(r repo.DomainRepository) port.DomainService {
	return &DomainService{
		repo: r,
	}
}

func (s *DomainService) ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error) {
	return s.repo.ListDomains(ctx, q)
}

func (s *DomainService) DomainCatalog(ctx context.Context) ([]entity.DomainCatalogItem, error) {
	return s.repo.DomainCatalog(ctx)
}

func (s *DomainService) CreateDomain(ctx context.Context, cmd entity.CreateDomainCommand) (*entity.ListDomainsItem, error) {
	cmd.Domain = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(cmd.Domain), "."))
	if len(cmd.Domain) > 253 || !regexp.MustCompile(`^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`).MatchString(cmd.Domain) {
		return nil, fmt.Errorf("invalid domain hostname")
	}
	for _, label := range strings.Split(strings.TrimPrefix(cmd.Domain, "*."), ".") {
		if len(label) == 0 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return nil, fmt.Errorf("invalid domain label")
		}
	}
	if cmd.Domain == "" {
		return nil, fmt.Errorf("domain name is required")
	}
	if cmd.RootDomain == "" {
		if cmd.Domain == "*" {
			cmd.RootDomain = "*"
		} else if strings.HasPrefix(cmd.Domain, "*.") {
			cmd.RootDomain = strings.TrimPrefix(cmd.Domain, "*.")
		} else {
			cmd.RootDomain = cmd.Domain
		}
	}
	if cmd.Upstream == "" {
		return nil, fmt.Errorf("upstream target is required")
	}
	cmd.Upstream = strings.TrimSpace(cmd.Upstream)
	if strings.Contains(cmd.Upstream, "://") {
		u, err := url.Parse(cmd.Upstream)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !regexp.MustCompile(`^[a-zA-Z0-9.\[\]:_-]+$`).MatchString(u.Host) {
			return nil, fmt.Errorf("origin must be an HTTP(S) URL without credentials, path, query or fragment")
		}
		if u.Port() != "" {
			port, err := strconv.Atoi(u.Port())
			if err != nil || port < 1 || port > 65535 {
				return nil, fmt.Errorf("invalid origin port")
			}
		}
	} else if !regexp.MustCompile(`^[a-z0-9_-]+$`).MatchString(cmd.Upstream) {
		return nil, fmt.Errorf("invalid upstream pool name")
	}
	if cmd.Status != "" && cmd.Status != "Active" && cmd.Status != "Inactive" {
		return nil, fmt.Errorf("invalid domain status")
	}
	if cmd.Status == "" {
		cmd.Status = "Active"
	}
	if cmd.TLSType == "" {
		cmd.TLSType = "Let's Encrypt"
	}
	if cmd.MinTLSVersion == "" {
		cmd.MinTLSVersion = "TLSv1.3"
	}
	if cmd.UpstreamAlgorithm == "" {
		cmd.UpstreamAlgorithm = "round_robin"
	}
	if cmd.HealthCheckPath == "" {
		cmd.HealthCheckPath = "/healthz"
	}
	if cmd.CreatedBy == "" {
		cmd.CreatedBy = "admin"
	}

	id, err := s.repo.Create(ctx, cmd)
	if err != nil {
		return nil, err
	}
	return s.repo.GetByID(ctx, id)
}

func (s *DomainService) GetDomain(ctx context.Context, id int64) (*entity.ListDomainsItem, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid domain id")
	}
	item, err := s.repo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, fmt.Errorf("domain not found")
	}
	return item, nil
}

func (s *DomainService) UpdateDomain(ctx context.Context, id int64, cmd entity.UpdateDomainCommand) (*entity.ListDomainsItem, error) {
	if id <= 0 {
		return nil, fmt.Errorf("invalid domain id")
	}
	if cmd.Upstream == "" {
		return nil, fmt.Errorf("upstream target is required")
	}
	cmd.Upstream = strings.TrimSpace(cmd.Upstream)
	if strings.Contains(cmd.Upstream, "://") {
		u, err := url.Parse(cmd.Upstream)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !regexp.MustCompile(`^[a-zA-Z0-9.\[\]:_-]+$`).MatchString(u.Host) {
			return nil, fmt.Errorf("origin must be an HTTP(S) URL without credentials, path, query or fragment")
		}
		if u.Port() != "" {
			port, err := strconv.Atoi(u.Port())
			if err != nil || port < 1 || port > 65535 {
				return nil, fmt.Errorf("invalid origin port")
			}
		}
	} else if !regexp.MustCompile(`^[a-z0-9_-]+$`).MatchString(cmd.Upstream) {
		return nil, fmt.Errorf("invalid upstream pool name")
	}
	if cmd.Status != "" && cmd.Status != "Active" && cmd.Status != "Inactive" {
		return nil, fmt.Errorf("invalid domain status")
	}
	if cmd.Status == "" {
		cmd.Status = "Active"
	}
	if cmd.TLSType == "" {
		cmd.TLSType = "Let's Encrypt"
	}
	if cmd.MinTLSVersion == "" {
		cmd.MinTLSVersion = "TLSv1.3"
	}
	if cmd.UpstreamAlgorithm == "" {
		cmd.UpstreamAlgorithm = "round_robin"
	}
	if cmd.HealthCheckPath == "" {
		cmd.HealthCheckPath = "/healthz"
	}

	if err := s.repo.Update(ctx, id, cmd); err != nil {
		return nil, err
	}
	return s.repo.GetByID(ctx, id)
}

func (s *DomainService) DeleteDomain(ctx context.Context, id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid domain id")
	}
	return s.repo.Delete(ctx, id)
}
