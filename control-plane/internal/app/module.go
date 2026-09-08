package app

import (
	"context"
	"database/sql"

	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"aurora-waf.local/control-plane/internal/transport/http/handler"
)

// Module là "thùng chứa" tập hợp tất cả handler HTTP của ứng dụng.
// Nó được khởi tạo một lần duy nhất khi ứng dụng khởi động,
// sau đó RegisterRoutes gắn các handler vào đúng URL tương ứng.
type Module struct {
	DependenciesHandler  *handler.DependenciesHandler
	AccessHandler        *handler.AccessHandler
	PolicyHandler        *handler.PolicyHandler
	HealthcheckHandler   *handler.HealthcheckHandler
	AuthHandler          *handler.AuthHandler
	AuthService          port.AuthService // Xác thực JWT — cần tham chiếu trong middleware
	RuleHandler          *handler.RuleHandler
	NodeHandler          *handler.NodeHandler
	MetricsHandler       *handler.MetricsHandler
	MetricsService       port.MetricsService
	DomainHandler        *handler.DomainHandler
	DomainRoutingHandler *handler.DomainRoutingHandler
	UpstreamHandler      *handler.UpstreamHandler
	RateLimitHandler     *handler.RateLimitHandler
	RateLimitCollector   *provider.RateLimitCollector
	SystemHandler        *handler.SystemHandler
	SecurityHandler      *handler.SecurityHandler
	NotificationHandler  *handler.NotificationHandler
	NotificationService  port.NotificationService
	NotificationWorker   *service.NotificationWorker
	BackupHandler        *handler.BackupHandler
	BackupScheduler      *service.BackupScheduler
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
	storageRepo := repository.NewStorageRepository(readerDB)
	healthcheckSvc := service.NewHealthcheckService(storageRepo)
	healthcheckHdr := handler.NewHealthcheckHandler(healthcheckSvc)

	authRepo := repository.NewAuthRepository(readerDB)
	authSvc := service.NewAuthService(authRepo, cfg)
	authHdr := handler.NewAuthHandler(authSvc)

	ruleRepo := repository.NewRuleRepository(writerDB, readerDB)
	ruleSvc := service.NewRuleService(ruleRepo, cfg.CompilerPath)
	ruleHdr := handler.NewRuleHandler(ruleSvc)

	policyRepo := repository.NewPolicyRepository(writerDB, readerDB)
	policySvc := service.NewPolicyService(policyRepo, cfg.CompilerPath)
	policyHdr := handler.NewPolicyHandler(policySvc)

	accessRepo := repository.NewAccessRepository(writerDB, readerDB)
	accessSvc := service.NewAccessService(accessRepo, cfg.CompilerPath)
	accessHdr := handler.NewAccessHandler(accessSvc)

	domainRepo := repository.NewDomainRepository(writerDB, readerDB)
	domainSvc := service.NewDomainService(domainRepo)
	domainHdr := handler.NewDomainHandler(domainSvc)

	domainRoutingRepo := repository.NewDomainRoutingRepository(readerDB)
	domainRoutingSvc := service.NewDomainRoutingService(domainRoutingRepo)
	domainRoutingHdr := handler.NewDomainRoutingHandler(domainRoutingSvc)

	upstreamRepo := repository.NewUpstreamRepository(writerDB, readerDB)
	upstreamSvc := service.NewUpstreamService(upstreamRepo)
	upstreamHdr := handler.NewUpstreamHandler(upstreamSvc)

	settingsRepo := repository.NewSettingsRepository(writerDB)
	metricsCfg, _ := settingsRepo.GetMetricsConfig(context.Background())
	if metricsCfg == nil {
		metricsCfg = &entity.MetricsIntegrationConfig{Mode: "standalone"}
	}

	rateLimitRepo := repository.NewRateLimitRepository(writerDB, readerDB)
	rateLimitMetricsProvider := provider.NewDynamicRateLimitMetricsProvider(settingsRepo, rateLimitRepo)
	rateLimitSvc := service.NewRateLimitService(rateLimitRepo, rateLimitMetricsProvider)
	rateLimitCollector := provider.NewRateLimitCollector(rateLimitSvc, cfg.RateLimitUDPAddr)
	rateLimitHdr := handler.NewRateLimitHandler(rateLimitSvc, rateLimitCollector)
	if metricsCfg.Mode == "disabled" {
		rateLimitCollector.SetEnabled(false)
	}

	nodeRepo := repository.NewNodeRepository(writerDB)
	metricsSvc := service.NewMetricsService(settingsRepo, nodeRepo)
	metricsSvc.RegisterConfigListener(func(mCfg entity.MetricsIntegrationConfig) {
		rateLimitCollector.SetEnabled(mCfg.Mode != "disabled")
	})
	eventHub := provider.NewEventHub()
	nodeSvc := service.NewNodeService(nodeRepo, metricsSvc, eventHub)
	nodeHdr := handler.NewNodeHandler(nodeSvc)
	metricsHdr := handler.NewMetricsHandler(metricsSvc)
	systemRepo := repository.NewSystemRepository(readerDB)
	systemSvc := service.NewSystemService(systemRepo, cfg)
	systemHdr := handler.NewSystemHandler(systemSvc)

	securityRepo := repository.NewSecurityRepository(writerDB)
	securitySvc := service.NewSecurityService(securityRepo)
	securityHdr := handler.NewSecurityHandler(securitySvc)

	notificationRepo := repository.NewNotificationRepository(writerDB)
	notificationProvider := provider.NewNotificationProvider()
	notificationWorker := service.NewNotificationWorker(notificationRepo, notificationProvider, 256)
	notificationSvc := service.NewNotificationService(notificationRepo, notificationProvider, notificationWorker)
	notificationHdr := handler.NewNotificationHandler(notificationSvc)

	backupRepo := repository.NewBackupRepository(writerDB)
	backupSvc := service.NewBackupService(writerDB, backupRepo, cfg.SQLitePath)
	backupHdr := handler.NewBackupHandler(backupSvc)
	backupScheduler := service.NewBackupScheduler(backupSvc, backupRepo)

	depRepo := repository.NewDependenciesRepository(writerDB, readerDB)
	depSvc := service.NewDependenciesService(depRepo)
	dependenciesHdr := handler.NewDependenciesHandler(depSvc)

	return &Module{
		DependenciesHandler:  dependenciesHdr,
		AccessHandler:        accessHdr,
		PolicyHandler:        policyHdr,
		HealthcheckHandler:   healthcheckHdr,
		AuthHandler:          authHdr,
		AuthService:          authSvc,
		RuleHandler:          ruleHdr,
		NodeHandler:          nodeHdr,
		MetricsHandler:       metricsHdr,
		MetricsService:       metricsSvc,
		DomainHandler:        domainHdr,
		DomainRoutingHandler: domainRoutingHdr,
		UpstreamHandler:      upstreamHdr,
		RateLimitHandler:     rateLimitHdr,
		RateLimitCollector:   rateLimitCollector,
		SystemHandler:        systemHdr,
		SecurityHandler:      securityHdr,
		NotificationHandler:  notificationHdr,
		NotificationService:  notificationSvc,
		NotificationWorker:   notificationWorker,
		BackupHandler:        backupHdr,
		BackupScheduler:      backupScheduler,
	}
}
