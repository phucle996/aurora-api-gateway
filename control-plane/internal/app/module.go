package app

import (
	"database/sql"
	"errors"

	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/repo"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	grpchandler "aurora-waf.local/control-plane/internal/transport/grpc/handler"
	"aurora-waf.local/control-plane/internal/transport/http/handler"
)

// Module là "thùng chứa" tập hợp tất cả handler HTTP của ứng dụng.
// Nó được khởi tạo một lần duy nhất khi ứng dụng khởi động,
// sau đó RegisterRoutes gắn các handler vào đúng URL tương ứng.
type Module struct {
	GRPCSpecSyncHandler *grpchandler.SpecSyncHandler
	SpecHandler         *handler.SpecHandler
	SpecSyncRepo        repo.SpecSyncRepository
	SpecScheduler       *provider.SpecScheduler
	HealthcheckHandler  *handler.HealthcheckHandler

	AuthHandler         *handler.AuthHandler
	AuthService         port.AuthService // Xác thực JWT — cần tham chiếu trong middleware
	AnalyticsHandler    *handler.AnalyticsHandler
	AnalyticsService    port.AnalyticsService
	RouteHandler        *handler.RouteHandler
	CertificateHandler  *handler.CertificateHandler
	UpstreamHandler     *handler.UpstreamHandler
	SystemHandler       *handler.SystemHandler
	SecurityHandler     *handler.SecurityHandler
	BackupHandler       *handler.BackupHandler
	BackupScheduler     *service.BackupScheduler
	ExtensionHandler    *handler.ExtensionHandler
	ExtensionService    port.ExtensionService
	L4Handler           *handler.L4Handler
	L4Service           port.L4Service
	AlertmanagerHandler *handler.AlertmanagerHandler
	AlertmanagerService port.AlertmanagerService
}

// NewModule khởi tạo toàn bộ chuỗi dependency của ứng dụng theo thứ tự:
//  1. Repository (sử dụng đúng writerDB hoặc readerDB tùy loại workflow)
//  2. Service    (nhận repository và chứa logic nghiệp vụ)
//  3. Handler    (bao đóng service thành Handler struct)
//
// writerDB dùng cho các mutation (tạo/sửa/publish rule).
// readerDB dùng cho các query (list/detail/stats/history).
// cfg cung cấp JWT secret, đường dẫn compiler và các thiết lập khác.
func NewModule(writerDB, readerDB *sql.DB, cfg config.Config) (*Module, error) {
	if writerDB == nil {
		return nil, errors.New("cannot initialize module: writerDB is nil")
	}
	if readerDB == nil {
		return nil, errors.New("cannot initialize module: readerDB is nil")
	}

	systemRepo := repository.NewSystemRepository(readerDB)
	if systemRepo == nil {
		return nil, errors.New("cannot initialize module: systemRepo is nil")
	}
	healthcheckSvc := service.NewHealthcheckService(systemRepo)
	if healthcheckSvc == nil {
		return nil, errors.New("cannot initialize module: healthcheckSvc is nil")
	}
	healthcheckHdr := handler.NewHealthcheckHandler(healthcheckSvc)
	if healthcheckHdr == nil {
		return nil, errors.New("cannot initialize module: healthcheckHdr is nil")
	}

	authRepo := repository.NewAuthRepository(readerDB)
	if authRepo == nil {
		return nil, errors.New("cannot initialize module: authRepo is nil")
	}
	authSvc := service.NewAuthService(authRepo, cfg)
	if authSvc == nil {
		return nil, errors.New("cannot initialize module: authSvc is nil")
	}
	authHdr := handler.NewAuthHandler(authSvc)
	if authHdr == nil {
		return nil, errors.New("cannot initialize module: authHdr is nil")
	}

	specSyncRepo := repository.NewSpecSyncRepository(writerDB, readerDB)
	if specSyncRepo == nil {
		return nil, errors.New("cannot initialize module: specSyncRepo is nil")
	}
	specScheduler := provider.NewSpecScheduler(0, 0)
	if specScheduler == nil {
		return nil, errors.New("cannot initialize module: specScheduler is nil")
	}
	specTrigger := specScheduler.TriggerReconcile

	upstreamRepo := repository.NewUpstreamRepository(writerDB, readerDB)
	if upstreamRepo == nil {
		return nil, errors.New("cannot initialize module: upstreamRepo is nil")
	}
	upstreamSvc := service.NewUpstreamService(upstreamRepo, specTrigger)
	if upstreamSvc == nil {
		return nil, errors.New("cannot initialize module: upstreamSvc is nil")
	}
	upstreamHdr := handler.NewUpstreamHandler(upstreamSvc)
	if upstreamHdr == nil {
		return nil, errors.New("cannot initialize module: upstreamHdr is nil")
	}

	routeRepo := repository.NewRouteRepository(writerDB)
	if routeRepo == nil {
		return nil, errors.New("cannot initialize module: routeRepo is nil")
	}
	routeSvc := service.NewRoutingService(routeRepo, specTrigger)
	if routeSvc == nil {
		return nil, errors.New("cannot initialize module: routeSvc is nil")
	}
	routeHdr := handler.NewRouteHandler(routeSvc)
	if routeHdr == nil {
		return nil, errors.New("cannot initialize module: routeHdr is nil")
	}

	certRepo := repository.NewSQLiteCertificateRepository(writerDB)
	if certRepo == nil {
		return nil, errors.New("cannot initialize module: certRepo is nil")
	}
	certSvc := service.NewCertificateService(certRepo, specTrigger)
	if certSvc == nil {
		return nil, errors.New("cannot initialize module: certSvc is nil")
	}
	certHdr := handler.NewCertificateHandler(certSvc)
	if certHdr == nil {
		return nil, errors.New("cannot initialize module: certHdr is nil")
	}

	analyticsRepo := repository.NewAnalyticsRepository(writerDB)
	if analyticsRepo == nil {
		return nil, errors.New("cannot initialize module: analyticsRepo is nil")
	}
	extensionRepo := repository.NewExtensionRepository(writerDB, readerDB)
	if extensionRepo == nil {
		return nil, errors.New("cannot initialize module: extensionRepo is nil")
	}
	analyticsSvc := service.NewAnalyticsService(analyticsRepo, extensionRepo)
	if analyticsSvc == nil {
		return nil, errors.New("cannot initialize module: analyticsSvc is nil")
	}
	analyticsHdr := handler.NewAnalyticsHandler(analyticsSvc)
	if analyticsHdr == nil {
		return nil, errors.New("cannot initialize module: analyticsHdr is nil")
	}
	systemSvc := service.NewSystemService(systemRepo, cfg)
	if systemSvc == nil {
		return nil, errors.New("cannot initialize module: systemSvc is nil")
	}
	systemHdr := handler.NewSystemHandler(systemSvc)
	if systemHdr == nil {
		return nil, errors.New("cannot initialize module: systemHdr is nil")
	}

	securityRepo := repository.NewSecurityRepository(writerDB)
	if securityRepo == nil {
		return nil, errors.New("cannot initialize module: securityRepo is nil")
	}
	securitySvc := service.NewSecurityService(securityRepo)
	if securitySvc == nil {
		return nil, errors.New("cannot initialize module: securitySvc is nil")
	}
	securityHdr := handler.NewSecurityHandler(securitySvc)
	if securityHdr == nil {
		return nil, errors.New("cannot initialize module: securityHdr is nil")
	}

	backupRepo := repository.NewBackupRepository(writerDB)
	if backupRepo == nil {
		return nil, errors.New("cannot initialize module: backupRepo is nil")
	}
	backupSvc := service.NewBackupService(writerDB, backupRepo, cfg.SQLitePath)
	if backupSvc == nil {
		return nil, errors.New("cannot initialize module: backupSvc is nil")
	}
	backupHdr := handler.NewBackupHandler(backupSvc)
	if backupHdr == nil {
		return nil, errors.New("cannot initialize module: backupHdr is nil")
	}
	backupScheduler := service.NewBackupScheduler(backupSvc, backupRepo)
	if backupScheduler == nil {
		return nil, errors.New("cannot initialize module: backupScheduler is nil")
	}

	specSyncSvc := service.NewSpecSyncService(specSyncRepo)
	if specSyncSvc == nil {
		return nil, errors.New("cannot initialize module: specSyncSvc is nil")
	}
	grpcSpecHdr := grpchandler.NewSpecSyncHandler(specSyncSvc)
	if grpcSpecHdr == nil {
		return nil, errors.New("cannot initialize module: grpcSpecHdr is nil")
	}
	specHdr := handler.NewSpecHandler(specSyncSvc)
	if specHdr == nil {
		return nil, errors.New("cannot initialize module: specHdr is nil")
	}

	extensionSvc := service.NewExtensionService(extensionRepo, specTrigger)
	if extensionSvc == nil {
		return nil, errors.New("cannot initialize module: extensionSvc is nil")
	}
	extensionHdr := handler.NewExtensionHandler(extensionSvc)
	if extensionHdr == nil {
		return nil, errors.New("cannot initialize module: extensionHdr is nil")
	}

	l4Repo := repository.NewL4Repository(writerDB, readerDB)
	if l4Repo == nil {
		return nil, errors.New("cannot initialize module: l4Repo is nil")
	}
	l4Svc := service.NewL4Service(l4Repo, specTrigger)
	if l4Svc == nil {
		return nil, errors.New("cannot initialize module: l4Svc is nil")
	}
	l4Hdr := handler.NewL4Handler(l4Svc, upstreamRepo)
	if l4Hdr == nil {
		return nil, errors.New("cannot initialize module: l4Hdr is nil")
	}

	alertmanagerRepo := repository.NewAlertmanagerRepository(writerDB)
	if alertmanagerRepo == nil {
		return nil, errors.New("cannot initialize module: alertmanagerRepo is nil")
	}
	alertmanagerSvc := service.NewAlertmanagerService(alertmanagerRepo)
	if alertmanagerSvc == nil {
		return nil, errors.New("cannot initialize module: alertmanagerSvc is nil")
	}
	alertmanagerHdr := handler.NewAlertmanagerHandler(alertmanagerSvc)
	if alertmanagerHdr == nil {
		return nil, errors.New("cannot initialize module: alertmanagerHdr is nil")
	}

	mod := &Module{
		GRPCSpecSyncHandler: grpcSpecHdr,
		SpecHandler:         specHdr,
		SpecSyncRepo:        specSyncRepo,
		SpecScheduler:       specScheduler,
		ExtensionHandler:    extensionHdr,
		ExtensionService:    extensionSvc,
		L4Handler:           l4Hdr,
		L4Service:           l4Svc,
		AlertmanagerHandler: alertmanagerHdr,
		AlertmanagerService: alertmanagerSvc,
		HealthcheckHandler:  healthcheckHdr,

		AuthHandler:        authHdr,
		AuthService:        authSvc,
		AnalyticsHandler:   analyticsHdr,
		AnalyticsService:   analyticsSvc,
		RouteHandler:       routeHdr,
		CertificateHandler: certHdr,
		UpstreamHandler:    upstreamHdr,
		SystemHandler:      systemHdr,
		SecurityHandler:    securityHdr,
		BackupHandler:      backupHdr,
		BackupScheduler:    backupScheduler,
	}

	return mod, nil
}
