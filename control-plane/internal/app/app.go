package app

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/config"
	"aurora-waf.local/control-plane/internal/console"
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// App là đối tượng cấp cao nhất, nắm giữ:
//   - db: cặp pool kết nối SQLite (Writer + Reader) — đóng khi tắt
//   - server: HTTP server với tất cả các route đã đăng ký
type App struct {
	db     *infra.DBPool
	server *http.Server
}

func init() {
	gin.SetMode(gin.ReleaseMode)
}

// NewApp khởi động ứng dụng theo trình tự:
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
	router.Use(gin.Recovery())

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
		_ = pools.Close()
		return nil, err
	}
	router.NoRoute(gin.WrapH(ui))

	return &App{db: pools, server: &http.Server{
		Addr: cfg.HTTPAddr, Handler: router,
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second,
		WriteTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second,
	}}, nil
}

func (a *App) Run(ctx context.Context) error {
	done := make(chan error, 1)
	go func() { done <- a.server.ListenAndServe() }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := a.server.Shutdown(shutdownCtx); err != nil {
			_ = a.server.Close()
			return err
		}
		err := <-done
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

// Close is called after Run has drained HTTP requests.
func (a *App) Close() error { return a.db.Close() }

func (a *App) Handler() http.Handler { return a.server.Handler }
