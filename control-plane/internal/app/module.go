package app

import (
	"database/sql"

	"aurora-waf.local/control-plane/internal/config"
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
	AccessHandler      *handler.AccessHandler
	PolicyHandler      *handler.PolicyHandler
	HealthcheckHandler *handler.HealthcheckHandler
	AuthHandler        *handler.AuthHandler
	AuthService        port.AuthService // Xác thực JWT — cần tham chiếu trong middleware
	RuleHandler        *handler.RuleHandler
	NodeHandler        *handler.NodeHandler
	MetricsHandler     *handler.MetricsHandler
	MetricsService     port.MetricsService
	DomainHandler      *handler.DomainHandler
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

	nodeRepo := repository.NewNodeRepository(writerDB)
	settingsRepo := repository.NewSettingsRepository(writerDB)
	metricsSvc := service.NewMetricsService(settingsRepo, nodeRepo)
	eventHub := provider.NewEventHub()
	nodeSvc := service.NewNodeService(nodeRepo, metricsSvc, eventHub)
	nodeHdr := handler.NewNodeHandler(nodeSvc)
	metricsHdr := handler.NewMetricsHandler(metricsSvc)

	return &Module{
		AccessHandler:      accessHdr,
		PolicyHandler:      policyHdr,
		HealthcheckHandler: healthcheckHdr,
		AuthHandler:        authHdr,
		AuthService:        authSvc,
		RuleHandler:        ruleHdr,
		NodeHandler:        nodeHdr,
		MetricsHandler:     metricsHdr,
		MetricsService:     metricsSvc,
		DomainHandler:      domainHdr,
	}
}
