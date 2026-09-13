package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
)

type CertificateServiceImpl struct {
	certRepo   repo.CertificateRepository
	onMutation func()
}

func NewCertificateService(
	r repo.CertificateRepository,
	onMutation ...func(),
) domainService.CertificateService {
	if r == nil {
		panic("certificateRepo cannot be nil")
	}
	var fn func()
	if len(onMutation) > 0 {
		fn = onMutation[0]
	}
	return &CertificateServiceImpl{
		certRepo:   r,
		onMutation: fn,
	}
}

func (s *CertificateServiceImpl) notifyMutation() {
	if s.onMutation != nil {
		s.onMutation()
	}
}

func (s *CertificateServiceImpl) ListCertificates(ctx context.Context, q entity.ListCertificatesQuery) (entity.ListCertificatesResult, error) {
	return s.certRepo.ListCertificates(ctx, q)
}

func (s *CertificateServiceImpl) GetCertificateByID(ctx context.Context, id string) (*entity.CertificateItem, error) {
	return s.certRepo.GetCertificateByID(ctx, id)
}

func (s *CertificateServiceImpl) CreateCertificate(ctx context.Context, cmd entity.CreateCertificateCommand) (*entity.CertificateItem, error) {
	if cmd.ID == "" {
		b := make([]byte, 6)
		rand.Read(b)
		cmd.ID = "cert_" + hex.EncodeToString(b)
	}

	if err := s.certRepo.CreateCertificate(ctx, cmd); err != nil {
		return nil, err
	}

	s.notifyMutation()
	return s.certRepo.GetCertificateByID(ctx, cmd.ID)
}

func (s *CertificateServiceImpl) UpdateCertificate(ctx context.Context, cmd entity.UpdateCertificateCommand) (*entity.CertificateItem, error) {
	if err := s.certRepo.UpdateCertificate(ctx, cmd); err != nil {
		return nil, err
	}

	s.notifyMutation()
	return s.certRepo.GetCertificateByID(ctx, cmd.ID)
}

func (s *CertificateServiceImpl) DeleteCertificate(ctx context.Context, id string) error {
	if err := s.certRepo.DeleteCertificate(ctx, id); err != nil {
		return err
	}
	s.notifyMutation()
	return nil
}

func (s *CertificateServiceImpl) ToggleCertificateStatus(ctx context.Context, id string, enabled bool) error {
	if err := s.certRepo.ToggleCertificateStatus(ctx, id, enabled); err != nil {
		return err
	}
	s.notifyMutation()
	return nil
}
