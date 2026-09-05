package infra

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// DBPool giữ hai kết nối riêng biệt đến cùng một file SQLite:
//   - Writer: đường kết nối duy nhất được phép ghi dữ liệu.
//   - Reader: nhóm kết nối chỉ đọc, có thể phục vụ nhiều request đồng thời.
//
// Tách hai pool giúp query đọc (LIST, STATS, DETAIL) không phải xếp hàng
// chờ sau các mutation (CREATE, UPDATE, PUBLISH) đang chiếm Writer.
type DBPool struct {
	Writer *sql.DB // Kết nối ghi — tối đa 1 goroutine dùng tại một thời điểm
	Reader *sql.DB // Pool đọc — nhiều goroutine dùng đồng thời nhờ WAL mode
}

// Close đóng cả hai pool theo thứ tự Writer trước, Reader sau.
// Nếu Writer lỗi, lỗi đó được trả về ngay; lỗi của Reader bị bỏ qua
// để không che khuất lỗi quan trọng hơn.
func (p *DBPool) Close() error {
	var errWriter, errReader error
	if p.Writer != nil {
		errWriter = p.Writer.Close()
	}
	if p.Reader != nil {
		errReader = p.Reader.Close()
	}
	if errWriter != nil {
		return errWriter
	}
	return errReader
}

// OpenSQLitePool mở SQLite theo mô hình 2 pool:
//
//   - Writer pool (MaxOpenConns=1): dùng cho tất cả thao tác ghi —
//     INSERT, UPDATE, DELETE, migration schema. Chỉ 1 kết nối để đảm
//     bảo không bao giờ có 2 transaction ghi xung đột nhau.
//
//   - Reader pool (MaxOpenConns = 2×NumCPU, tối thiểu 4): mở ở chế độ
//     read-only (`mode=ro`, `query_only=1`). Nhiều kết nối đọc có thể
//     chạy song song nhờ SQLite WAL mode — reader không block writer
//     và writer không block reader.
//
// Trước khi trả về, hàm kiểm tra WAL đã bật trên Writer và ping Reader
// để đảm bảo cả hai kết nối sẵn sàng.
func OpenSQLitePool(ctx context.Context, path string) (*DBPool, error) {
	if strings.TrimSpace(path) == "" || path == ":memory:" {
		return nil, fmt.Errorf("SQLite requires a persistent database path")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0700); err != nil {
		return nil, fmt.Errorf("create SQLite directory: %w", err)
	}
	file, err := os.OpenFile(abs, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, fmt.Errorf("open SQLite file: %w", err)
	}
	if err := file.Close(); err != nil {
		return nil, err
	}

	// --- Writer DB ---
	// MaxOpenConns=1: serialise mọi thao tác ghi; không bao giờ có 2 writer cùng lúc.
	// busy_timeout(5000): nếu file bị khóa, chờ tối đa 5 giây trước khi báo lỗi.
	// foreign_keys(1): bật ràng buộc khoá ngoại ở cấp độ kết nối.
	// synchronous(FULL): đảm bảo fsync sau mỗi transaction để không mất dữ liệu khi crash.
	writerQuery := url.Values{}
	for _, pragma := range []string{"busy_timeout(5000)", "foreign_keys(1)", "synchronous(FULL)"} {
		writerQuery.Add("_pragma", pragma)
	}
	writerDSN := url.URL{Scheme: "file", Path: filepath.ToSlash(abs), RawQuery: writerQuery.Encode()}
	writerDB, err := sql.Open("sqlite", writerDSN.String())
	if err != nil {
		return nil, err
	}
	writerDB.SetMaxOpenConns(1)
	writerDB.SetMaxIdleConns(1)

	var mode string
	if err := writerDB.QueryRowContext(ctx, "PRAGMA journal_mode=WAL").Scan(&mode); err != nil {
		writerDB.Close()
		return nil, fmt.Errorf("enable SQLite WAL: %w", err)
	}
	if mode != "wal" {
		writerDB.Close()
		return nil, fmt.Errorf("SQLite WAL unavailable: got %q", mode)
	}

	// --- Reader DB ---
	// mode=ro: mở file SQLite ở chế độ read-only ở cấp OS — ngăn ghi ngay
	//   từ tầng file, bảo vệ double-layer cùng với query_only.
	// query_only(1): pragma SQLite bổ sung, từ chối bất kỳ statement nào
	//   có thể thay đổi dữ liệu (INSERT/UPDATE/DELETE/CREATE...).
	// busy_timeout & foreign_keys giống Writer để hành vi nhất quán.
	readerQuery := url.Values{}
	readerQuery.Set("mode", "ro")
	for _, pragma := range []string{"busy_timeout(5000)", "foreign_keys(1)", "query_only(1)"} {
		readerQuery.Add("_pragma", pragma)
	}
	readerDSN := url.URL{Scheme: "file", Path: filepath.ToSlash(abs), RawQuery: readerQuery.Encode()}
	readerDB, err := sql.Open("sqlite", readerDSN.String())
	if err != nil {
		writerDB.Close()
		return nil, err
	}

	// Số kết nối reader = 2 × số CPU, tối thiểu 4.
	// ConnMaxLifetime=1h: sau 1 giờ, kết nối cũ sẽ bị thay bằng kết nối mới,
	// giúp tránh file descriptor leak và làm tươi pragma per-connection.
	maxReaders := runtime.NumCPU() * 2
	if maxReaders < 4 {
		maxReaders = 4
	}
	readerDB.SetMaxOpenConns(maxReaders)
	readerDB.SetMaxIdleConns(maxReaders / 2)
	readerDB.SetConnMaxLifetime(1 * time.Hour)

	if err := readerDB.PingContext(ctx); err != nil {
		writerDB.Close()
		readerDB.Close()
		return nil, fmt.Errorf("ping reader SQLite: %w", err)
	}

	return &DBPool{
		Writer: writerDB,
		Reader: readerDB,
	}, nil
}

// OpenSQLite là hàm tiện ích cho các công cụ CLI đơn giản (ví dụ: aurora-activate)
// vốn không cần pool đọc riêng. Nó mở 2 pool rồi đóng Reader ngay lập tức,
// chỉ giữ lại Writer duy nhất để dùng.
//
// Lưu ý: không dùng OpenSQLite cho control-plane chính — dùng OpenSQLitePool.
func OpenSQLite(ctx context.Context, path string) (*sql.DB, error) {
	pools, err := OpenSQLitePool(ctx, path)
	if err != nil {
		return nil, err
	}
	_ = pools.Reader.Close()
	return pools.Writer, nil
}
