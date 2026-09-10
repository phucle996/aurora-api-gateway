package service

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// CertificateService định nghĩa hợp đồng nghiệp vụ cho SSL Certificate workflow.
type CertificateService interface {
	ListCertificates(ctx context.Context, q entity.ListCertificatesQuery) (entity.ListCertificatesResult, error)
	GetCertificateByID(ctx context.Context, id string) (*entity.CertificateItem, error)
	CreateCertificate(ctx context.Context, cmd entity.CreateCertificateCommand) (*entity.CertificateItem, error)
	UpdateCertificate(ctx context.Context, cmd entity.UpdateCertificateCommand) (*entity.CertificateItem, error)
	DeleteCertificate(ctx context.Context, id string) error
}
