package app

import (
	"aurora-waf.local/control-plane/internal/config"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"aurora-waf.local/control-plane/internal/transport/http/handler"
	"database/sql"

	"github.com/gin-gonic/gin"
)

// Module là "thùng chứa" tập hợp tất cả handler HTTP của ứng dụng.
// Nó được khởi tạo một lần duy nhất khi ứng dụng khởi động,
// sau đó RegisterRoutes gắn các handler vào đúng URL tương ứng.
type Module struct {
	StatusHandler *handler.StatusHandler // /healthz, /readyz, /api/v1/status
	AuthHandler   *handler.AuthHandler   // /api/v1/auth/login, logout, /me
	AuthService   port.AuthService       // Xác thực JWT — cần tham chiếu trong middleware

	// --- Rule & Release handlers ---
	// Mỗi trường tương ứng một route cụ thể.
	// Handler đã chứa sẵn service và repository bên trong
	// nên route.go không cần biết chi tiết khởi tạo.
	CreateRuleDefinition gin.HandlerFunc // POST /api/v2/rules
	ListRules            gin.HandlerFunc // GET  /api/v1/rules
	CreateRule           gin.HandlerFunc // POST /api/v1/rules
	RuleStats            gin.HandlerFunc // GET  /api/v1/rules/stats
	RuleDetail           gin.HandlerFunc // GET  /api/v1/rules/:id
	UpdateRule           gin.HandlerFunc // PUT  /api/v1/rules/:id
	RuleHistory          gin.HandlerFunc // GET  /api/v1/rules/:id/history
	PublishRules         gin.HandlerFunc // POST /api/v1/rule-releases
	ReleaseDetail        gin.HandlerFunc // GET  /api/v1/rule-releases/:id

	// --- Cluster Node handlers ---
	ListNodes  gin.HandlerFunc // GET  /api/v1/nodes
	NodeDetail gin.HandlerFunc // GET  /api/v1/nodes/:id
}

// NewModule khởi tạo toàn bộ chuỗi dependency của ứng dụng theo thứ tự:
//   1. Repository (sử dụng đúng writerDB hoặc readerDB tùy loại workflow)
//   2. Service    (nhận repository và chứa logic nghiệp vụ)
//   3. Handler    (bao đóng service thành gin.HandlerFunc)
//
// writerDB dùng cho các mutation (tạo/sửa/publish rule).
// readerDB dùng cho các query (list/detail/stats/history).
// cfg cung cấp JWT secret, đường dẫn compiler và các thiết lập khác.
func NewModule(writerDB, readerDB *sql.DB, cfg config.Config) *Module {
	storageRepo := repository.NewStorageRepository(readerDB)
	statusSvc := service.NewStatusService(storageRepo)
	statusHdr := handler.NewStatusHandler(statusSvc)

	authRepo := repository.NewAuthRepository(readerDB)
	authSvc := service.NewAuthService(authRepo, cfg)
	authHdr := handler.NewAuthHandler(authSvc)

	ruleRepo := repository.NewRuleRepository(writerDB, readerDB)
	ruleSvc := service.NewRuleService(ruleRepo, cfg.CompilerPath)

	nodeRepo := repository.NewNodeRepository(readerDB)
	nodeSvc := service.NewNodeService(nodeRepo)

	createDefHdr := handler.CreateRuleDefinition(ruleSvc)
	listRulesHdr := handler.ListRules(ruleSvc)
	createRuleHdr := handler.CreateRule(ruleSvc)
	ruleStatsHdr := handler.RuleStats(ruleSvc)
	ruleDetailHdr := handler.RuleDetail(ruleSvc)
	updateRuleHdr := handler.UpdateRule(ruleSvc)
	ruleHistoryHdr := handler.RuleHistory(ruleSvc)
	publishRulesHdr := handler.PublishRules(ruleSvc)
	releaseDetailHdr := handler.ReleaseDetail(ruleSvc)
	listNodesHdr := handler.ListNodes(nodeSvc)
	nodeDetailHdr := handler.GetNodeByID(nodeSvc)

	return &Module{
		StatusHandler:        statusHdr,
		AuthHandler:          authHdr,
		AuthService:          authSvc,
		CreateRuleDefinition: createDefHdr,
		ListRules:            listRulesHdr,
		CreateRule:           createRuleHdr,
		RuleStats:            ruleStatsHdr,
		RuleDetail:           ruleDetailHdr,
		UpdateRule:           updateRuleHdr,
		RuleHistory:          ruleHistoryHdr,
		PublishRules:         publishRulesHdr,
		ReleaseDetail:        releaseDetailHdr,
		ListNodes:            listNodesHdr,
		NodeDetail:           nodeDetailHdr,
	}
}
