package service

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	domainService "aurora-waf.local/control-plane/internal/domain/service"
)

var validUpstreamNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// UpstreamService thực thi nghiệp vụ cho Upstream workflow.
type UpstreamService struct {
	repo       repo.UpstreamRepository
	onMutation func()
}

// NewUpstreamService khởi tạo UpstreamService với repo tương ứng và mutation callback tùy chọn.
func NewUpstreamService(r repo.UpstreamRepository, onMutation ...func()) domainService.UpstreamService {
	var fn func()
	if len(onMutation) > 0 {
		fn = onMutation[0]
	}
	return &UpstreamService{
		repo:       r,
		onMutation: fn,
	}
}

func (s *UpstreamService) notifyMutation() {
	if s.onMutation != nil {
		s.onMutation()
	}
}

// CreateUpstream thẩm định, tạo mới upstream pool và sinh NGINX directive block.
func (s *UpstreamService) CreateUpstream(ctx context.Context, cmd entity.CreateUpstreamCommand) (*entity.UpstreamItem, error) {
	// 1. Thẩm định tên pool
	trimmedName := strings.TrimSpace(cmd.Name)
	if trimmedName == "" {
		return nil, fmt.Errorf("tên upstream không được để trống")
	}
	if !validUpstreamNameRegex.MatchString(trimmedName) {
		return nil, fmt.Errorf("tên upstream chỉ được chứa chữ cái, số, dấu gạch ngang (-) hoặc gạch dưới (_)")
	}
	cmd.Name = strings.ToLower(trimmedName)

	// 2. Kiểm tra trùng tên
	existing, err := s.repo.GetByName(ctx, cmd.Name)
	if err != nil {
		return nil, fmt.Errorf("kiểm tra trùng tên upstream: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("upstream với tên '%s' đã tồn tại", cmd.Name)
	}

	// 3. Thẩm định kiến trúc và servers
	switch cmd.ArchitectureType {
	case "Single Server":
		if len(cmd.Servers) != 1 || strings.TrimSpace(cmd.Servers[0].Address) == "" {
			return nil, fmt.Errorf("kiểu Single Server yêu cầu ít nhất 1 địa chỉ backend hợp lệ")
		}
		cmd.Servers[0].Weight = 1
		cmd.Servers[0].Healthy = false
		cmd.Algorithm = "round_robin"
	case "Load Balancer":
		if len(cmd.Servers) == 0 {
			return nil, fmt.Errorf("kiểu Load Balancer yêu cầu ít nhất 1 máy chủ trong pool")
		}
		for i := range cmd.Servers {
			srv := &cmd.Servers[i]
			srv.Address = strings.TrimSpace(srv.Address)
			if srv.Address == "" {
				return nil, fmt.Errorf("địa chỉ máy chủ thứ %d không được để trống", i+1)
			}
			if srv.Weight < 0 {
				return nil, fmt.Errorf("negative backend weight")
			}
			if srv.Weight == 0 {
				srv.Weight = 1
			}

			if srv.FailTimeout == "" {
				srv.FailTimeout = "10s"
			}
			srv.Healthy = false
		}
		if cmd.Algorithm != "round_robin" && cmd.Algorithm != "least_conn" && cmd.Algorithm != "ip_hash" {
			return nil, fmt.Errorf("invalid balancing algorithm")
		}
	case "External (FQDN)":
		cmd.ExternalFQDN = strings.TrimSpace(cmd.ExternalFQDN)
		if cmd.ExternalFQDN == "" {
			return nil, fmt.Errorf("kiểu External FQDN yêu cầu nhập tên miền origin hợp lệ")
		}
		cmd.Servers = []entity.UpstreamNode{
			{
				ID:      "ext-origin",
				Address: cmd.ExternalFQDN,
				Weight:  1,
				Healthy: false,
			},
		}
		cmd.Algorithm = "round_robin"
	default:
		return nil, fmt.Errorf("invalid architecture type")
	}

	// 4. Mặc định Transport & Probes nếu thiếu
	if cmd.Transport.HTTPVersion == "HTTP/3" {
		return nil, fmt.Errorf("NGINX does not support HTTP/3 to upstream")
	}
	if cmd.Transport.RequestCompression != "" && cmd.Transport.RequestCompression != "none" {
		return nil, fmt.Errorf("NGINX request compression is unavailable; send pre-compressed bodies from the client")
	}
	if len(cmd.Probes) > 0 {
		return nil, fmt.Errorf("active health probes are unavailable in this NGINX runtime; remove probes to use passive failure detection")
	}
	if cmd.Transport.HTTPVersion == "" {
		cmd.Transport.HTTPVersion = "HTTP/1.1"
	}
	if cmd.Transport.KeepAliveConnections < 0 {
		return nil, fmt.Errorf("negative keepalive limit")
	}
	if cmd.Transport.KeepAliveConnections == 0 {
		cmd.Transport.KeepAliveConnections = 32
	}

	if cmd.Transport.HTTPVersion != "HTTP/1.1" && cmd.Transport.HTTPVersion != "HTTP/1.0" && cmd.Transport.HTTPVersion != "HTTP/2" && cmd.Transport.HTTPVersion != "HTTP/3" {
		return nil, fmt.Errorf("invalid origin HTTP version")
	}
	if cmd.Transport.RequestCompression == "" {
		cmd.Transport.RequestCompression = "none"
	}
	if cmd.Transport.RequestCompression != "none" && cmd.Transport.RequestCompression != "gzip" && cmd.Transport.RequestCompression != "deflate" {
		return nil, fmt.Errorf("invalid request compression")
	}
	if cmd.Transport.CompressionLevel < 0 || cmd.Transport.CompressionLevel > 9 || cmd.Transport.CompressionMinBytes < 0 || cmd.Transport.CompressionMinBytes > 1048576 {
		return nil, fmt.Errorf("invalid request compression limits")
	}
	if cmd.Transport.EnableGRPC && cmd.Transport.RequestCompression == "deflate" {
		return nil, fmt.Errorf("gRPC message compression supports gzip, not HTTP deflate")
	}
	if cmd.Transport.EnableGRPC && cmd.Transport.HTTPVersion != "HTTP/2" {
		return nil, fmt.Errorf("gRPC requires HTTP/2 transport")
	}
	if cmd.Transport.HTTPVersion == "HTTP/3" && !cmd.InternalSSL.Enabled {
		return nil, fmt.Errorf("HTTP/3 requires HTTPS enabled")
	}
	if cmd.Transport.EnableWebSocket && cmd.Transport.HTTPVersion != "HTTP/1.1" {
		return nil, fmt.Errorf("WebSocket Upgrade requires HTTP/1.1 origin transport")
	}
	probeIDs := map[string]bool{}
	for i := range cmd.Probes {
		probe := &cmd.Probes[i]
		if strings.TrimSpace(probe.ID) == "" || probeIDs[probe.ID] {
			return nil, fmt.Errorf("probe IDs must be nonempty and unique")
		}
		probeIDs[probe.ID] = true
		if probe.Type != "Readiness" && probe.Type != "Liveness" && probe.Type != "Health" {
			return nil, fmt.Errorf("invalid probe type")
		}
		if !strings.HasPrefix(probe.Path, "/") || strings.HasPrefix(probe.Path, "//") || strings.ContainsAny(probe.Path, "\r\n") {
			return nil, fmt.Errorf("probe path must be an absolute request path")
		}
		if probe.ExpectedStatus == 0 {
			probe.ExpectedStatus = 200
		}
		if probe.ExpectedStatus < 100 || probe.ExpectedStatus > 599 {
			return nil, fmt.Errorf("invalid probe expected status")
		}
		if probe.IntervalSec == 0 {
			probe.IntervalSec = 10
		}
		if probe.TimeoutSec == 0 {
			probe.TimeoutSec = 2
		}
		if probe.IntervalSec < 1 || probe.IntervalSec > 3600 || probe.TimeoutSec < 1 || probe.TimeoutSec > 60 || probe.TimeoutSec > probe.IntervalSec {
			return nil, fmt.Errorf("invalid probe timing")
		}
	}
	if cmd.ArchitectureType == "External (FQDN)" && cmd.SNIOverride && cmd.InternalSSL.Enabled {
		origin, err := url.Parse("https://" + cmd.ExternalFQDN)
		if err != nil || origin.Hostname() == "" {
			return nil, fmt.Errorf("invalid SNI origin")
		}
		cmd.InternalSSL.SNIHost = origin.Hostname()
	}
	if err := validateUpstreamTLS(cmd.InternalSSL); err != nil {
		return nil, err
	}
	if cmd.InternalSSL.Enabled && cmd.InternalSSL.VerifyCert && cmd.InternalSSL.SNIHost == "" {
		return nil, fmt.Errorf("verified origin TLS requires SNI hostname")
	}
	if cmd.InternalSSL.SNIHost != "" && !regexp.MustCompile(`^[a-zA-Z0-9.-]+$`).MatchString(cmd.InternalSSL.SNIHost) {
		return nil, fmt.Errorf("invalid SNI hostname")
	}
	if cmd.Transport.KeepAliveConnections > 4096 || cmd.Transport.KeepAliveTimeout < 0 || cmd.Transport.KeepAliveTimeout > 3600 {
		return nil, fmt.Errorf("invalid keepalive limits")
	}
	primary := false
	for _, server := range cmd.Servers {
		if !regexp.MustCompile(`^[a-zA-Z0-9.\[\]:_-]+$`).MatchString(server.Address) {
			return nil, fmt.Errorf("invalid backend address")
		}
		u, err := url.Parse("http://" + server.Address)
		if err != nil || u.Hostname() == "" {
			return nil, fmt.Errorf("invalid backend address")
		}
		if u.Port() != "" {
			port, err := strconv.Atoi(u.Port())
			if err != nil || port < 1 || port > 65535 {
				return nil, fmt.Errorf("invalid backend port")
			}
		}
		if server.Weight < 0 || server.Weight > 10000 || server.MaxFails < 0 || server.MaxFails > 10000 || (server.FailTimeout != "" && !regexp.MustCompile(`^[0-9]{1,6}[smh]$`).MatchString(server.FailTimeout)) {
			return nil, fmt.Errorf("invalid backend weight/failure settings")
		}
		if server.Backup && cmd.Algorithm == "ip_hash" {
			return nil, fmt.Errorf("ip_hash cannot use backup peers")
		}
		if !server.Backup {
			primary = true
		}
	}
	if !primary {
		return nil, fmt.Errorf("pool requires at least one primary backend")
	}
	// 5. Lấy danh sách upstreams hiện tại để sinh cấu hình NGINX tổng thể
	allUpstreams, _, err := s.repo.List(ctx, entity.ListUpstreamsQuery{Limit: 1000})
	if err != nil {
		return nil, fmt.Errorf("tải danh sách upstream hiện tại: %w", err)
	}

	// Ghép upstream mới vào danh sách sinh config
	newCandidate := entity.UpstreamItem{
		Name:             cmd.Name,
		ArchitectureType: cmd.ArchitectureType,
		Algorithm:        cmd.Algorithm,
		Servers:          cmd.Servers,
		ExternalFQDN:     cmd.ExternalFQDN,
		Transport:        cmd.Transport,
		InternalSSL:      cmd.InternalSSL,
	}
	fullList := append(allUpstreams, newCandidate)

	generatedConf := GenerateNginxUpstreamsConf(fullList)
	hash := sha256.Sum256([]byte(generatedConf))
	digest := hex.EncodeToString(hash[:])

	// 6. Lưu vào DB và tạo release mới
	created, err := s.repo.Create(ctx, cmd, generatedConf, digest)
	if err != nil {
		return nil, fmt.Errorf("lưu upstream: %w", err)
	}

	s.notifyMutation()
	return created, nil
}

// UpdateUpstream thẩm định dữ liệu, cập nhật upstream pool và cập nhật NGINX directive block.
func (s *UpstreamService) UpdateUpstream(ctx context.Context, cmd entity.UpdateUpstreamCommand) (*entity.UpstreamItem, error) {
	if cmd.ID <= 0 {
		return nil, fmt.Errorf("id upstream không hợp lệ")
	}

	// 1. Kiểm tra tồn tại
	current, err := s.repo.GetByID(ctx, cmd.ID)
	if err != nil {
		return nil, fmt.Errorf("kiểm tra upstream tồn tại: %w", err)
	}
	if current == nil {
		return nil, fmt.Errorf("không tìm thấy upstream id=%d", cmd.ID)
	}

	cmd.ExpectedVersion = current.Version
	if cmd.InternalSSL.MTLS && cmd.InternalSSL.ClientKey == "" {
		cmd.InternalSSL.ClientKey = current.InternalSSL.ClientKey
	}
	// 2. Thẩm định tên
	trimmedName := strings.TrimSpace(cmd.Name)
	if trimmedName == "" {
		return nil, fmt.Errorf("tên upstream không được để trống")
	}
	for _, ch := range trimmedName {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_') {
			return nil, fmt.Errorf("tên upstream chỉ được chứa chữ cái, số, dấu gạch nối và gạch dưới")
		}
	}
	cmd.Name = strings.ToLower(trimmedName)

	// Kiểm tra trùng tên với upstream khác
	if cmd.Name != current.Name {
		existing, err := s.repo.GetByName(ctx, cmd.Name)
		if err != nil {
			return nil, fmt.Errorf("kiểm tra trùng tên upstream: %w", err)
		}
		if existing != nil && existing.ID != cmd.ID {
			return nil, fmt.Errorf("upstream với tên '%s' đã tồn tại", cmd.Name)
		}
	}

	// 3. Thẩm định kiến trúc và servers
	switch cmd.ArchitectureType {
	case "Single Server":
		if len(cmd.Servers) != 1 || strings.TrimSpace(cmd.Servers[0].Address) == "" {
			return nil, fmt.Errorf("kiểu Single Server yêu cầu ít nhất 1 địa chỉ backend hợp lệ")
		}
		cmd.Servers[0].Weight = 1
		cmd.Servers[0].Healthy = false
		cmd.Algorithm = "round_robin"
	case "Load Balancer":
		if len(cmd.Servers) == 0 {
			return nil, fmt.Errorf("kiểu Load Balancer yêu cầu ít nhất 1 máy chủ trong pool")
		}
		for i := range cmd.Servers {
			srv := &cmd.Servers[i]
			srv.Address = strings.TrimSpace(srv.Address)
			if srv.Address == "" {
				return nil, fmt.Errorf("địa chỉ máy chủ thứ %d không được để trống", i+1)
			}
			if srv.Weight < 0 {
				return nil, fmt.Errorf("negative backend weight")
			}
			if srv.Weight == 0 {
				srv.Weight = 1
			}

			if srv.FailTimeout == "" {
				srv.FailTimeout = "10s"
			}
			srv.Healthy = false
		}
		if cmd.Algorithm != "round_robin" && cmd.Algorithm != "least_conn" && cmd.Algorithm != "ip_hash" {
			return nil, fmt.Errorf("invalid balancing algorithm")
		}
	case "External (FQDN)":
		cmd.ExternalFQDN = strings.TrimSpace(cmd.ExternalFQDN)
		if cmd.ExternalFQDN == "" {
			return nil, fmt.Errorf("kiểu External FQDN yêu cầu nhập tên miền origin hợp lệ")
		}
		cmd.Servers = []entity.UpstreamNode{
			{
				ID:      "ext-origin",
				Address: cmd.ExternalFQDN,
				Weight:  1,
				Healthy: false,
			},
		}
		cmd.Algorithm = "round_robin"
	default:
		return nil, fmt.Errorf("invalid architecture type")
	}

	// 4. Mặc định Transport & Probes nếu thiếu
	if cmd.Transport.HTTPVersion == "HTTP/3" {
		return nil, fmt.Errorf("NGINX does not support HTTP/3 to upstream")
	}
	if cmd.Transport.RequestCompression != "" && cmd.Transport.RequestCompression != "none" {
		return nil, fmt.Errorf("NGINX request compression is unavailable; send pre-compressed bodies from the client")
	}
	if len(cmd.Probes) > 0 {
		return nil, fmt.Errorf("active health probes are unavailable in this NGINX runtime; remove probes to use passive failure detection")
	}
	if cmd.Transport.HTTPVersion == "" {
		cmd.Transport.HTTPVersion = "HTTP/1.1"
	}
	if cmd.Transport.KeepAliveConnections < 0 {
		return nil, fmt.Errorf("negative keepalive limit")
	}
	if cmd.Transport.KeepAliveConnections == 0 {
		cmd.Transport.KeepAliveConnections = 32
	}

	if cmd.Transport.HTTPVersion != "HTTP/1.1" && cmd.Transport.HTTPVersion != "HTTP/1.0" && cmd.Transport.HTTPVersion != "HTTP/2" && cmd.Transport.HTTPVersion != "HTTP/3" {
		return nil, fmt.Errorf("invalid origin HTTP version")
	}
	if cmd.Transport.RequestCompression == "" {
		cmd.Transport.RequestCompression = "none"
	}
	if cmd.Transport.RequestCompression != "none" && cmd.Transport.RequestCompression != "gzip" && cmd.Transport.RequestCompression != "deflate" {
		return nil, fmt.Errorf("invalid request compression")
	}
	if cmd.Transport.CompressionLevel < 0 || cmd.Transport.CompressionLevel > 9 || cmd.Transport.CompressionMinBytes < 0 || cmd.Transport.CompressionMinBytes > 1048576 {
		return nil, fmt.Errorf("invalid request compression limits")
	}
	if cmd.Transport.EnableGRPC && cmd.Transport.RequestCompression == "deflate" {
		return nil, fmt.Errorf("gRPC message compression supports gzip, not HTTP deflate")
	}
	if cmd.Transport.EnableGRPC && cmd.Transport.HTTPVersion != "HTTP/2" {
		return nil, fmt.Errorf("gRPC requires HTTP/2 transport")
	}
	if cmd.Transport.HTTPVersion == "HTTP/3" && !cmd.InternalSSL.Enabled {
		return nil, fmt.Errorf("HTTP/3 requires HTTPS enabled")
	}
	if cmd.Transport.EnableWebSocket && cmd.Transport.HTTPVersion != "HTTP/1.1" {
		return nil, fmt.Errorf("WebSocket Upgrade requires HTTP/1.1 origin transport")
	}
	probeIDs := map[string]bool{}
	for i := range cmd.Probes {
		probe := &cmd.Probes[i]
		if strings.TrimSpace(probe.ID) == "" || probeIDs[probe.ID] {
			return nil, fmt.Errorf("probe IDs must be nonempty and unique")
		}
		probeIDs[probe.ID] = true
		if probe.Type != "Readiness" && probe.Type != "Liveness" && probe.Type != "Health" {
			return nil, fmt.Errorf("invalid probe type")
		}
		if !strings.HasPrefix(probe.Path, "/") || strings.HasPrefix(probe.Path, "//") || strings.ContainsAny(probe.Path, "\r\n") {
			return nil, fmt.Errorf("probe path must be an absolute request path")
		}
		if probe.ExpectedStatus == 0 {
			probe.ExpectedStatus = 200
		}
		if probe.ExpectedStatus < 100 || probe.ExpectedStatus > 599 {
			return nil, fmt.Errorf("invalid probe expected status")
		}
		if probe.IntervalSec == 0 {
			probe.IntervalSec = 10
		}
		if probe.TimeoutSec == 0 {
			probe.TimeoutSec = 2
		}
		if probe.IntervalSec < 1 || probe.IntervalSec > 3600 || probe.TimeoutSec < 1 || probe.TimeoutSec > 60 || probe.TimeoutSec > probe.IntervalSec {
			return nil, fmt.Errorf("invalid probe timing")
		}
	}
	if cmd.ArchitectureType == "External (FQDN)" && cmd.SNIOverride && cmd.InternalSSL.Enabled {
		origin, err := url.Parse("https://" + cmd.ExternalFQDN)
		if err != nil || origin.Hostname() == "" {
			return nil, fmt.Errorf("invalid SNI origin")
		}
		cmd.InternalSSL.SNIHost = origin.Hostname()
	}
	if err := validateUpstreamTLS(cmd.InternalSSL); err != nil {
		return nil, err
	}
	if cmd.InternalSSL.Enabled && cmd.InternalSSL.VerifyCert && cmd.InternalSSL.SNIHost == "" {
		return nil, fmt.Errorf("verified origin TLS requires SNI hostname")
	}
	if cmd.InternalSSL.SNIHost != "" && !regexp.MustCompile(`^[a-zA-Z0-9.-]+$`).MatchString(cmd.InternalSSL.SNIHost) {
		return nil, fmt.Errorf("invalid SNI hostname")
	}
	if cmd.Transport.KeepAliveConnections > 4096 || cmd.Transport.KeepAliveTimeout < 0 || cmd.Transport.KeepAliveTimeout > 3600 {
		return nil, fmt.Errorf("invalid keepalive limits")
	}
	primary := false
	for _, server := range cmd.Servers {
		if !regexp.MustCompile(`^[a-zA-Z0-9.\[\]:_-]+$`).MatchString(server.Address) {
			return nil, fmt.Errorf("invalid backend address")
		}
		u, err := url.Parse("http://" + server.Address)
		if err != nil || u.Hostname() == "" {
			return nil, fmt.Errorf("invalid backend address")
		}
		if u.Port() != "" {
			port, err := strconv.Atoi(u.Port())
			if err != nil || port < 1 || port > 65535 {
				return nil, fmt.Errorf("invalid backend port")
			}
		}
		if server.Weight < 0 || server.Weight > 10000 || server.MaxFails < 0 || server.MaxFails > 10000 || (server.FailTimeout != "" && !regexp.MustCompile(`^[0-9]{1,6}[smh]$`).MatchString(server.FailTimeout)) {
			return nil, fmt.Errorf("invalid backend weight/failure settings")
		}
		if server.Backup && cmd.Algorithm == "ip_hash" {
			return nil, fmt.Errorf("ip_hash cannot use backup peers")
		}
		if !server.Backup {
			primary = true
		}
	}
	if !primary {
		return nil, fmt.Errorf("pool requires at least one primary backend")
	}
	// 5. Tải danh sách upstreams để tái sinh toàn bộ cấu hình NGINX
	allUpstreams, _, err := s.repo.List(ctx, entity.ListUpstreamsQuery{Limit: 1000})
	if err != nil {
		return nil, fmt.Errorf("tải danh sách upstream hiện tại: %w", err)
	}

	// Thay thế upstream tương ứng trong fullList
	fullList := make([]entity.UpstreamItem, 0, len(allUpstreams))
	found := false
	for _, u := range allUpstreams {
		if u.ID == cmd.ID {
			fullList = append(fullList, entity.UpstreamItem{
				ID:               cmd.ID,
				Name:             cmd.Name,
				ArchitectureType: cmd.ArchitectureType,
				Algorithm:        cmd.Algorithm,
				Servers:          cmd.Servers,
				ExternalFQDN:     cmd.ExternalFQDN,
				Transport:        cmd.Transport,
				InternalSSL:      cmd.InternalSSL,
			})
			found = true
		} else {
			fullList = append(fullList, u)
		}
	}
	if !found {
		fullList = append(fullList, entity.UpstreamItem{
			ID:               cmd.ID,
			Name:             cmd.Name,
			ArchitectureType: cmd.ArchitectureType,
			Algorithm:        cmd.Algorithm,
			Servers:          cmd.Servers,
			ExternalFQDN:     cmd.ExternalFQDN,
			Transport:        cmd.Transport,
			InternalSSL:      cmd.InternalSSL,
		})
	}

	generatedConf := GenerateNginxUpstreamsConf(fullList)
	hash := sha256.Sum256([]byte(generatedConf))
	digest := hex.EncodeToString(hash[:])

	// 6. Ghi vào repo
	updated, err := s.repo.Update(ctx, cmd, generatedConf, digest)
	if err != nil {
		return nil, fmt.Errorf("cập nhật upstream: %w", err)
	}

	s.notifyMutation()
	return updated, nil
}

// GetUpstream lấy chi tiết một upstream theo ID.
func (s *UpstreamService) GetUpstream(ctx context.Context, id int64) (*entity.UpstreamItem, error) {
	return s.repo.GetByID(ctx, id)
}

// DeleteUpstream kiểm tra, xóa upstream pool và sinh lại snapshot cấu hình NGINX.
func (s *UpstreamService) DeleteUpstream(ctx context.Context, id int64) error {
	if id <= 0 {
		return fmt.Errorf("id upstream không hợp lệ")
	}

	// 1. Tải danh sách upstreams hiện tại
	all, _, err := s.repo.List(ctx, entity.ListUpstreamsQuery{Limit: 1000})
	if err != nil {
		return fmt.Errorf("tải danh sách upstream: %w", err)
	}

	// 2. Lọc bỏ upstream cần xóa để sinh cấu hình NGINX mới
	var remaining []entity.UpstreamItem
	found := false
	for _, u := range all {
		if u.ID == id {
			found = true
			continue
		}
		remaining = append(remaining, u)
	}
	if !found {
		return fmt.Errorf("upstream not found")
	}

	// 3. Sinh cấu hình NGINX mới
	generatedConf := GenerateNginxUpstreamsConf(remaining)
	hasher := sha256.New()
	hasher.Write([]byte(generatedConf))
	digest := hex.EncodeToString(hasher.Sum(nil))

	// 4. Xóa trong repo và ghi release snapshot
	if err := s.repo.Delete(ctx, id, generatedConf, digest); err != nil {
		return err
	}
	s.notifyMutation()
	return nil
}

// ListUpstreams lấy danh sách upstreams theo bộ lọc.
func (s *UpstreamService) ListUpstreams(ctx context.Context, query entity.ListUpstreamsQuery) ([]entity.UpstreamItem, int, error) {
	return s.repo.List(ctx, query)
}

// GetDesiredSnapshot lấy snapshot cho node NGINX.
func (s *UpstreamService) GetDesiredSnapshot(ctx context.Context, nodeID string) (*entity.UpstreamSnapshot, error) {
	return s.repo.GetLatestSnapshot(ctx)
}

// ReportSyncStatus lưu kết quả đồng bộ từ node.
func (s *UpstreamService) ReportSyncStatus(ctx context.Context, nodeID string, releaseID int64, phase, message string) error {
	return s.repo.RecordNodeSync(ctx, nodeID, releaseID, phase, message)
}

// GenerateNginxUpstreamsConf sinh nội dung file active-upstreams.conf cho NGINX.
func GenerateNginxUpstreamsConf(upstreams []entity.UpstreamItem) string {
	var sb strings.Builder
	sb.WriteString("# Auto-generated Aurora API Gateway Upstreams Configuration\n")
	sb.WriteString("# Do not edit manually - managed by Aurora Control-Plane\n\n")

	for _, u := range upstreams {
		sb.WriteString(fmt.Sprintf("upstream %s {\n", u.Name))
		if u.ArchitectureType == "Load Balancer" && u.Algorithm != "round_robin" {
			sb.WriteString(fmt.Sprintf("    %s;\n", u.Algorithm))
		}

		for _, srv := range u.Servers {
			var flags []string
			if srv.Weight > 0 && u.ArchitectureType == "Load Balancer" {
				flags = append(flags, fmt.Sprintf("weight=%d", srv.Weight))
			}
			if srv.MaxFails > 0 {
				flags = append(flags, fmt.Sprintf("max_fails=%d", srv.MaxFails))
			}
			if srv.FailTimeout != "" {
				flags = append(flags, fmt.Sprintf("fail_timeout=%s", srv.FailTimeout))
			}
			if srv.Backup {
				flags = append(flags, "backup")
			}

			flagStr := ""
			if len(flags) > 0 {
				flagStr = " " + strings.Join(flags, " ")
			}

			sb.WriteString(fmt.Sprintf("    server %s%s;\n", srv.Address, flagStr))
		}

		keepalive := u.Transport.KeepAliveConnections
		if keepalive <= 0 {
			keepalive = 32
		}
		sb.WriteString(fmt.Sprintf("    keepalive %d;\n", keepalive))
		sb.WriteString("}\n\n")
	}

	return sb.String()
}

// Both upstream mutations must enforce the same credential invariant before writing
// secrets. Keeping this validator private prevents divergence between create/rotate.
func validateUpstreamTLS(v entity.UpstreamInternalSSL) error {
	if !v.Enabled && (v.MTLS || v.CACert != "" || v.ClientCert != "" || v.ClientKey != "") {
		return fmt.Errorf("origin credentials require HTTPS enabled")
	}
	if !v.MTLS && (v.ClientCert != "" || v.ClientKey != "") {
		return fmt.Errorf("client credentials require mTLS enabled")
	}
	if v.MTLS && !v.VerifyCert {
		return fmt.Errorf("mTLS requires origin certificate verification")
	}
	if v.CACert != "" {
		if strings.TrimSpace(v.CACert) == "" {
			return fmt.Errorf("CA bundle must not be empty")
		}
		if !v.VerifyCert {
			return fmt.Errorf("custom CA requires origin certificate verification")
		}
		rest := []byte(v.CACert)
		for len(strings.TrimSpace(string(rest))) > 0 {
			block, tail := pem.Decode(rest)
			if block == nil || block.Type != "CERTIFICATE" {
				return fmt.Errorf("CA bundle must contain PEM certificates only")
			}
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil || !cert.IsCA || time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
				return fmt.Errorf("CA certificate is invalid, expired or not a CA")
			}
			rest = tail
		}
	}
	if v.MTLS {
		if v.ClientCert == "" || v.ClientKey == "" {
			return fmt.Errorf("mTLS requires a client certificate and private key")
		}
		pair, err := tls.X509KeyPair([]byte(v.ClientCert), []byte(v.ClientKey))
		if err != nil {
			return fmt.Errorf("client certificate and private key must be a matching, unencrypted PEM pair")
		}
		for i, raw := range pair.Certificate {
			cert, err := x509.ParseCertificate(raw)
			if err != nil || time.Now().Before(cert.NotBefore) || !time.Now().Before(cert.NotAfter) {
				return fmt.Errorf("client certificate chain contains an invalid or expired certificate")
			}
			if i == 0 && len(cert.ExtKeyUsage) > 0 {
				allowed := false
				for _, usage := range cert.ExtKeyUsage {
					if usage == x509.ExtKeyUsageClientAuth || usage == x509.ExtKeyUsageAny {
						allowed = true
					}
				}
				if !allowed {
					return fmt.Errorf("client certificate must allow client authentication")
				}
			}
		}
	}
	return nil
}
