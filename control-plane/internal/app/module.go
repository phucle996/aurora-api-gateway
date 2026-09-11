package app

import (
	"context"
	"database/sql"

	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
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
	GRPCHeartbeatHandler *grpchandler.HeartbeatHandler
	GRPCSpecSyncHandler  *grpchandler.SpecSyncHandler
	SpecHandler          *handler.SpecHandler
	SpecSyncRepo         repo.SpecSyncRepository
	SpecScheduler        *provider.SpecScheduler
	HealthcheckHandler   *handler.HealthcheckHandler

	AuthHandler          *handler.AuthHandler
	AuthService          port.AuthService // Xác thực JWT — cần tham chiếu trong middleware
	NodeHandler          *handler.NodeHandler
	AnalyticsHandler     *handler.AnalyticsHandler
	AnalyticsService     port.AnalyticsService
	RouteHandler         *handler.RouteHandler
	CertificateHandler   *handler.CertificateHandler
	UpstreamHandler      *handler.UpstreamHandler
	SystemHandler        *handler.SystemHandler
	SecurityHandler      *handler.SecurityHandler
	BackupHandler        *handler.BackupHandler
	BackupScheduler      *service.BackupScheduler
	ExtensionHandler     *handler.ExtensionHandler
	ExtensionService     port.ExtensionService
	L4Handler            *handler.L4Handler
	L4Service            port.L4Service
	AlertmanagerHandler  *handler.AlertmanagerHandler
	AlertmanagerService  port.AlertmanagerService
}


// NewModule khởi tạo toàn bộ chuỗi dependency của ứng dụng theo thứ tự:
//  1. Repository (sử dụng đúng writerDB hoặc readerDB tùy loại workflow)
//  2. Service    (nhận repository và chứa logic nghiệp vụ)
//  3. Handler    (bao đóng service thành Handler struct)
//
// writerDB dùng cho các mutation (tạo/sửa/publish rule).
// readerDB dùng cho các query (list/detail/stats/history).
// cfg cung cấp JWT secret, đường dẫn compiler và các thiết lập khác.
func NewModule(writerDB, readerDB *sql.DB, cfg config.Config) *Module {
	systemRepo := repository.NewSystemRepository(readerDB)
	healthcheckSvc := service.NewHealthcheckService(systemRepo)
	healthcheckHdr := handler.NewHealthcheckHandler(healthcheckSvc)

	authRepo := repository.NewAuthRepository(readerDB)
	authSvc := service.NewAuthService(authRepo, cfg)
	authHdr := handler.NewAuthHandler(authSvc)

	specSyncRepo := repository.NewSpecSyncRepository(writerDB, readerDB)
	specScheduler := provider.NewSpecScheduler(0, 0)
	specTrigger := specScheduler.TriggerReconcile

	upstreamRepo := repository.NewUpstreamRepository(writerDB, readerDB)

	upstreamSvc := service.NewUpstreamService(upstreamRepo, specTrigger)
	upstreamHdr := handler.NewUpstreamHandler(upstreamSvc)

	routeRepo := repository.NewRouteRepository(writerDB)
	routeSvc := service.NewRoutingService(routeRepo, specTrigger)
	routeHdr := handler.NewRouteHandler(routeSvc)

	certRepo := repository.NewSQLiteCertificateRepository(writerDB)
	certSvc := service.NewCertificateService(certRepo, specTrigger)
	certHdr := handler.NewCertificateHandler(certSvc)

	analyticsRepo := repository.NewAnalyticsRepository(writerDB)
	metricsCfg, _ := analyticsRepo.GetMetricsConfig(context.Background())
	if metricsCfg == nil {
		metricsCfg = &entity.MetricsIntegrationConfig{Mode: "prometheus"}
	}

	nodeRepo := repository.NewNodeRepository(writerDB)
	extensionRepo := repository.NewExtensionRepository(writerDB, readerDB)
	analyticsSvc := service.NewAnalyticsService(analyticsRepo, nodeRepo, extensionRepo)
	eventHub := provider.NewEventHub()
	nodeSvc := service.NewNodeService(nodeRepo, analyticsSvc, eventHub)
	nodeHdr := handler.NewNodeHandler(nodeSvc)
	analyticsHdr := handler.NewAnalyticsHandler(analyticsSvc)
	systemSvc := service.NewSystemService(systemRepo, cfg)
	systemHdr := handler.NewSystemHandler(systemSvc)

	securityRepo := repository.NewSecurityRepository(writerDB)
	securitySvc := service.NewSecurityService(securityRepo)
	securityHdr := handler.NewSecurityHandler(securitySvc)

	backupRepo := repository.NewBackupRepository(writerDB)
	backupSvc := service.NewBackupService(writerDB, backupRepo, cfg.SQLitePath)
	backupHdr := handler.NewBackupHandler(backupSvc)
	backupScheduler := service.NewBackupScheduler(backupSvc, backupRepo)

	grpcHeartbeatHdr := grpchandler.NewHeartbeatHandler(nodeSvc)

	specSyncSvc := service.NewSpecSyncService(specSyncRepo)
	grpcSpecHdr := grpchandler.NewSpecSyncHandler(specSyncSvc)
	specHdr := handler.NewSpecHandler(specSyncSvc)

	extensionSvc := service.NewExtensionService(extensionRepo, specTrigger)
	extensionHdr := handler.NewExtensionHandler(extensionSvc)

	l4Repo := repository.NewL4Repository(writerDB, readerDB)
	l4Svc := service.NewL4Service(l4Repo, specTrigger)
	l4Hdr := handler.NewL4Handler(l4Svc, upstreamRepo)

	alertmanagerRepo := repository.NewAlertmanagerRepository(writerDB)
	alertmanagerSvc := service.NewAlertmanagerService(alertmanagerRepo)
	alertmanagerHdr := handler.NewAlertmanagerHandler(alertmanagerSvc)

	return &Module{
		GRPCHeartbeatHandler: grpcHeartbeatHdr,
		GRPCSpecSyncHandler:  grpcSpecHdr,
		SpecHandler:          specHdr,
		SpecSyncRepo:         specSyncRepo,
		SpecScheduler:        specScheduler,
		ExtensionHandler:     extensionHdr,
		ExtensionService:     extensionSvc,
		L4Handler:            l4Hdr,
		L4Service:            l4Svc,
		AlertmanagerHandler:  alertmanagerHdr,
		AlertmanagerService:  alertmanagerSvc,
		HealthcheckHandler:   healthcheckHdr,

		AuthHandler:          authHdr,
		AuthService:          authSvc,
		NodeHandler:          nodeHdr,
		AnalyticsHandler:     analyticsHdr,
		AnalyticsService:     analyticsSvc,
		RouteHandler:         routeHdr,
		CertificateHandler:   certHdr,
		UpstreamHandler:      upstreamHdr,
		SystemHandler:        systemHdr,
		SecurityHandler:      securityHdr,
		BackupHandler:        backupHdr,
		BackupScheduler:      backupScheduler,
	}
}

