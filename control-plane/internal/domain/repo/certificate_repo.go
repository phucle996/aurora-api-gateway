package repo

import (
	"context"

	"aurora-waf.local/control-plane/internal/domain/entity"
)

// CertificateRepository quản lý các thao tác dữ liệu của SSL Certificate workflow.
type CertificateRepository interface {
	ListCertificates(ctx context.Context, q entity.ListCertificatesQuery) (entity.ListCertificatesResult, error)
	GetCertificateByID(ctx context.Context, id string) (*entity.CertificateItem, error)
	CreateCertificate(ctx context.Context, cmd entity.CreateCertificateCommand) error
	UpdateCertificate(ctx context.Context, cmd entity.UpdateCertificateCommand) error
	DeleteCertificate(ctx context.Context, id string) error
	ToggleCertificateStatus(ctx context.Context, id string, enabled bool) error
	GetAllActiveCertificates(ctx context.Context) ([]entity.CertificateItem, error)
}
