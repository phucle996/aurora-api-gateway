package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/console"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/provider"
	"aurora-waf.local/control-plane/internal/service"
	grpcserver "aurora-waf.local/control-plane/internal/transport/grpc"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"

	"github.com/gin-gonic/gin"
)

// App là đối tượng cấp cao nhất, nắm giữ:
//   - db: cặp pool kết nối SQLite (Writer + Reader) — đóng khi tắt
//   - server: HTTP server với tất cả các route đã đăng ký
//   - grpcServer: gRPC server cho giao tiếp Dataplane Node
type App struct {
	db                 *infra.DBPool
	server             *http.Server
	grpcServer         *grpcserver.Server
	grpcLis            net.Listener
	metrics            port.MetricsService
	collector          *provider.RateLimitCollector
	backupScheduler    *service.BackupScheduler
	notificationWorker *service.NotificationWorker
	checkpointDone     chan struct{}
}

func init() {
	gin.SetMode(gin.ReleaseMode)
}

// NewApp khởi động ứng dụng theo trình tự:
//  0. Kiểm tra an toàn bảo mật môi trường Production (Fail-fast)
//  1. Mở SQLite Pool (Writer + Reader)
//  2. Chạy migration — đảm bảo schema luôn ở phiên bản mới nhất
//  3. Đọc admin token từ file nếu có cấu hình
//  4. Khởi tạo toàn bộ handler qua NewModule
//  5. Gắn route qua RegisterRoutes
//  6. Khởi tạo UI tĩnh (embedded console)
//  7. Trả về App sẵn sàng chạy
func NewApp(ctx context.Context, cfg config.Config) (*App, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	pools, err := infra.OpenSQLitePool(ctx, cfg.SQLitePath)
	if err != nil {
		return nil, err
	}
	if err := runMigrations(ctx, pools.Writer); err != nil {
		_ = pools.Close()
		return nil, fmt.Errorf("migrate SQLite: %w", err)
	}

	router := gin.New()

	// Cấu hình danh sách Reverse Proxies đáng tin cậy
	if len(cfg.TrustedProxies) > 0 {
		_ = router.SetTrustedProxies(cfg.TrustedProxies)
	} else {
		_ = router.SetTrustedProxies(nil)
	}

	router.Use(
		middleware.RequestID(),
		middleware.AccessLogger(),
		gin.Recovery(),
	)

	// Admin token là một chuỗi ngẫu nhiên dài ≥ 32 ký tự lưu trong file riêng.
	// File phải là file thường, quyền không rộng hơn 0600 (đọc/ghi chỉ owner).
	// Token này cho phép dụng cụ CI/CD gọi API mà không cần đăng nhập.
	var token string
	if cfg.AdminTokenFile != "" {
		info, err := os.Stat(cfg.AdminTokenFile)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 256 {
			_ = pools.Close()
			return nil, fmt.Errorf("admin token must be a private regular file, at most 256 bytes")
		}
		data, err := os.ReadFile(cfg.AdminTokenFile)
		if err != nil {
			_ = pools.Close()
			return nil, fmt.Errorf("read admin token: %w", err)
		}
		token = strings.TrimSpace(string(data))
		if len(token) < 32 || len(token) > 128 || strings.ContainsAny(token, " \t\r\n") {
			_ = pools.Close()
			return nil, fmt.Errorf("invalid admin token")
		}
	}

	module := NewModule(pools.Writer, pools.Reader, cfg)
	RegisterRoutes(router, module, token)

	// UI tĩnh (console quản trị) được nhúng trực tiếp vào binary.
	// Gin rọi route chưa khớp sẽ có bắt được vào đây (SPA fallback).
	ui, err := console.NewHandler()
	if err != nil {
		_ = module.MetricsService.Close()
		_ = pools.Close()
		return nil, err
	}
	router.NoRoute(gin.WrapH(ui))

	module.RateLimitCollector.Start(context.Background())
	module.BackupScheduler.Start(context.Background())
	if module.NotificationWorker != nil {
		module.NotificationWorker.Start(context.Background())
	}

	// Khởi chạy goroutine duy trì WAL checkpoint định kỳ (mỗi 30 phút)
	checkpointDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = pools.Checkpoint(context.Background(), "PASSIVE")
			case <-checkpointDone:
				return
			}
		}
	}()

	grpcSrv := grpcserver.NewServer(cfg.GRPCAddr, token, grpcserver.Handlers{
		Heartbeat:     module.GRPCHeartbeatHandler,
		Policy:        module.GRPCPolicySyncHandler,
		Access:        module.GRPCAccessSyncHandler,
		Upstream:      module.GRPCUpstreamSyncHandler,
		DomainRouting: module.GRPCDomainRoutingHandler,
		Module:        module.GRPCModuleSyncHandler,
	})
	grpcLis, err := net.Listen("tcp", cfg.GRPCAddr)
	if err != nil {
		_ = module.MetricsService.Close()
		_ = pools.Close()
		return nil, fmt.Errorf("listen gRPC %s: %w", cfg.GRPCAddr, err)
	}

	return &App{
		db: pools,
		server: &http.Server{
			Addr:              cfg.HTTPAddr,
			Handler:           router,
			ReadHeaderTimeout: 10 * time.Second,
			IdleTimeout:       120 * time.Second,
		},
		grpcServer:         grpcSrv,
		grpcLis:            grpcLis,
		metrics:            module.MetricsService,
		collector:          module.RateLimitCollector,
		backupScheduler:    module.BackupScheduler,
		notificationWorker: module.NotificationWorker,
		checkpointDone:     checkpointDone,
	}, nil
}

func (a *App) Run(ctx context.Context) error {
	httpDone := make(chan error, 1)
	grpcDone := make(chan error, 1)

	go func() { httpDone <- a.server.ListenAndServe() }()
	go func() { grpcDone <- a.grpcServer.Serve(a.grpcLis) }()

	select {
	case err := <-httpDone:
		a.grpcServer.GracefulStop()
		return err
	case err := <-grpcDone:
		_ = a.server.Close()
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		a.grpcServer.GracefulStop()
		if err := a.server.Shutdown(shutdownCtx); err != nil {
			_ = a.server.Close()
			return err
		}
		err := <-httpDone
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

// Close is called after Run has drained HTTP requests.
func (a *App) Close() error {
	if a.grpcServer != nil {
		a.grpcServer.GracefulStop()
	}
	if a.checkpointDone != nil {
		close(a.checkpointDone)
	}
	if a.backupScheduler != nil {
		a.backupScheduler.Stop()
	}
	if a.collector != nil {
		a.collector.Stop()
	}
	if a.notificationWorker != nil {
		a.notificationWorker.Stop()
	}

	// Thực hiện TRUNCATE checkpoint để thu hồi toàn bộ dung lượng file WAL trước khi ngắt kết nối
	if a.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_ = a.db.Checkpoint(ctx, "TRUNCATE")
		cancel()
	}

	return errors.Join(a.metrics.Close(), a.db.Close())
}

func (a *App) Handler() http.Handler { return a.server.Handler }
