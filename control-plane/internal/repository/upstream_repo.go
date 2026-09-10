package repository

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

// UpstreamRepository triển khai cổng lưu trữ repo.UpstreamRepository theo chuẩn CTE-first.
type UpstreamRepository struct {
	writer *sql.DB
	reader *sql.DB
}

// NewUpstreamRepository khởi tạo repository với writer và reader database pools.
func NewUpstreamRepository(writer, reader *sql.DB) repo.UpstreamRepository {
	return &UpstreamRepository{
		writer: writer,
		reader: reader,
	}
}

// Create thực thi transaction tạo mới upstream và sinh release mới cho Data Plane.
func (r *UpstreamRepository) Create(
	ctx context.Context,
	cmd entity.CreateUpstreamCommand,
	generatedConf string,
	digest string,
) (*entity.UpstreamItem, error) {
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	serversBytes, err := json.Marshal(toRepoNodes(cmd.Servers))
	if err != nil {
		return nil, fmt.Errorf("marshal servers: %w", err)
	}

	sslBytes, err := json.Marshal(toRepoInternalSSL(cmd.InternalSSL))
	if err != nil {
		return nil, fmt.Errorf("marshal internal ssl: %w", err)
	}

	probesBytes, err := json.Marshal(toRepoProbes(cmd.Probes))
	if err != nil {
		return nil, fmt.Errorf("marshal probes: %w", err)
	}

	transportBytes, err := json.Marshal(toRepoTransport(cmd.Transport))
	if err != nil {
		return nil, fmt.Errorf("marshal transport: %w", err)
	}

	sniOverrideInt := 0
	if cmd.SNIOverride {
		sniOverrideInt = 1
	}
	dynamicDNSInt := 0
	if cmd.DynamicDNS {
		dynamicDNSInt = 1
	}

	// 1. Chèn bản ghi Upstream mới
	const insertUpstreamSQL = `
	INSERT INTO upstreams (
		name, description, architecture_type, algorithm,
		servers_json, external_fqdn, sni_override, dynamic_dns,
		internal_ssl_json, probes_json, transport_json, version
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
	RETURNING id, created_at, updated_at;
	`

	var id int64
	var createdAt, updatedAt string
	err = tx.QueryRowContext(
		ctx,
		insertUpstreamSQL,
		cmd.Name,
		cmd.Description,
		cmd.ArchitectureType,
		cmd.Algorithm,
		string(serversBytes),
		cmd.ExternalFQDN,
		sniOverrideInt,
		dynamicDNSInt,
		string(sslBytes),
		string(probesBytes),
		string(transportBytes),
	).Scan(&id, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("insert upstream: %w", err)
	}

	// 2. Tăng và lưu trữ upstream_releases ledger
	const insertReleaseSQL = `
	WITH next_release AS (
		SELECT COALESCE(MAX(release_id), 0) + 1 AS new_id FROM upstream_releases
	)
	INSERT INTO upstream_releases (release_id, digest, config_content)
	SELECT new_id, ?, ? FROM next_release
	RETURNING release_id;
	`
	var newReleaseID int64
	err = tx.QueryRowContext(ctx, insertReleaseSQL, digest, generatedConf).Scan(&newReleaseID)
	if err != nil {
		return nil, fmt.Errorf("record upstream release: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	return &entity.UpstreamItem{
		ID:                id,
		Name:              cmd.Name,
		Description:       cmd.Description,
		ArchitectureType:  cmd.ArchitectureType,
		Algorithm:         cmd.Algorithm,
		Servers:           cmd.Servers,
		ExternalFQDN:      cmd.ExternalFQDN,
		SNIOverride:       cmd.SNIOverride,
		DynamicDNS:        cmd.DynamicDNS,
		InternalSSL:       cmd.InternalSSL,
		Probes:            cmd.Probes,
		Transport:         cmd.Transport,
		Version:           1,
		BoundDomainsCount: 0,
		CreatedAt:         createdAt,
		UpdatedAt:         updatedAt,
	}, nil
}

// Update cập nhật cấu hình upstream pool và ghi nhận snapshot release mới.
func (r *UpstreamRepository) Update(
	ctx context.Context,
	cmd entity.UpdateUpstreamCommand,
	generatedConf string,
	digest string,
) (*entity.UpstreamItem, error) {
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("bắt đầu transaction: %w", err)
	}
	defer tx.Rollback()

	// 1. Kiểm tra tồn tại và lấy tên cũ
	var oldName string
	var oldVersion int
	const checkSQL = `SELECT name, version FROM upstreams WHERE id = ?;`
	if err := tx.QueryRowContext(ctx, checkSQL, cmd.ID).Scan(&oldName, &oldVersion); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("không tìm thấy upstream có id=%d", cmd.ID)
		}
		return nil, fmt.Errorf("truy vấn upstream cũ: %w", err)
	}

	if cmd.ExpectedVersion > 0 && oldVersion != cmd.ExpectedVersion {
		return nil, fmt.Errorf("upstream changed concurrently; reload before saving")
	}
	serversBytes, err := json.Marshal(toRepoNodes(cmd.Servers))
	if err != nil {
		return nil, fmt.Errorf("serialize servers: %w", err)
	}
	sslBytes, err := json.Marshal(toRepoInternalSSL(cmd.InternalSSL))
	if err != nil {
		return nil, fmt.Errorf("serialize internal ssl: %w", err)
	}
	probesBytes, err := json.Marshal(toRepoProbes(cmd.Probes))
	if err != nil {
		return nil, fmt.Errorf("serialize probes: %w", err)
	}
	transportBytes, err := json.Marshal(toRepoTransport(cmd.Transport))
	if err != nil {
		return nil, fmt.Errorf("serialize transport: %w", err)
	}

	sniOverrideInt := 0
	if cmd.SNIOverride {
		sniOverrideInt = 1
	}
	dynamicDNSInt := 0
	if cmd.DynamicDNS {
		dynamicDNSInt = 1
	}

	// 2. Cập nhật bảng upstreams với version mới
	const updateSQL = `
	UPDATE upstreams
	SET 
		name = ?,
		description = ?,
		architecture_type = ?,
		algorithm = ?,
		servers_json = ?,
		external_fqdn = ?,
		sni_override = ?,
		dynamic_dns = ?,
		internal_ssl_json = ?,
		probes_json = ?,
		transport_json = ?,
		version = version + 1,
		updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	WHERE id = ?
	RETURNING version, created_at, updated_at;
	`
	var newVersion int
	var createdAt, updatedAt string
	err = tx.QueryRowContext(
		ctx,
		updateSQL,
		cmd.Name,
		cmd.Description,
		cmd.ArchitectureType,
		cmd.Algorithm,
		string(serversBytes),
		cmd.ExternalFQDN,
		sniOverrideInt,
		dynamicDNSInt,
		string(sslBytes),
		string(probesBytes),
		string(transportBytes),
		cmd.ID,
	).Scan(&newVersion, &createdAt, &updatedAt)
	if err != nil {
		return nil, fmt.Errorf("update upstream: %w", err)
	}

	// 3. Nếu tên upstream thay đổi, cập nhật các route đang tham chiếu
	if oldName != cmd.Name {
		const updateRoutesSQL = `UPDATE routes SET upstream_name = ? WHERE upstream_name = ?;`
		if _, err := tx.ExecContext(ctx, updateRoutesSQL, cmd.Name, oldName); err != nil {
			return nil, fmt.Errorf("cập nhật tham chiếu route: %w", err)
		}
	}

	// 4. Lấy số lượng route đang liên kết
	var boundCount int
	const countRoutesSQL = `SELECT COUNT(*) FROM routes WHERE upstream_name = ?;`
	if err := tx.QueryRowContext(ctx, countRoutesSQL, cmd.Name).Scan(&boundCount); err != nil {
		boundCount = 0
	}

	// 5. Ghi nhận snapshot release mới
	const insertReleaseSQL = `
	WITH next_release AS (
		SELECT COALESCE(MAX(release_id), 0) + 1 AS new_id FROM upstream_releases
	)
	INSERT INTO upstream_releases (release_id, digest, config_content)
	SELECT new_id, ?, ? FROM next_release
	RETURNING release_id;
	`
	var newReleaseID int64
	err = tx.QueryRowContext(ctx, insertReleaseSQL, digest, generatedConf).Scan(&newReleaseID)
	if err != nil {
		return nil, fmt.Errorf("record upstream release: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit transaction: %w", err)
	}

	return &entity.UpstreamItem{
		ID:                cmd.ID,
		Name:              cmd.Name,
		Description:       cmd.Description,
		ArchitectureType:  cmd.ArchitectureType,
		Algorithm:         cmd.Algorithm,
		Servers:           cmd.Servers,
		ExternalFQDN:      cmd.ExternalFQDN,
		SNIOverride:       cmd.SNIOverride,
		DynamicDNS:        cmd.DynamicDNS,
		InternalSSL:       cmd.InternalSSL,
		Probes:            cmd.Probes,
		Transport:         cmd.Transport,
		Version:           newVersion,
		BoundDomainsCount: boundCount,
		CreatedAt:         createdAt,
		UpdatedAt:         updatedAt,
	}, nil
}

// GetByID lấy chi tiết upstream theo ID.
func (r *UpstreamRepository) GetByID(ctx context.Context, id int64) (*entity.UpstreamItem, error) {
	const querySQL = `
	WITH target_upstream AS (
		SELECT 
			u.id, u.name, u.description, u.architecture_type, u.algorithm,
			u.servers_json, u.external_fqdn, u.sni_override, u.dynamic_dns,
			u.internal_ssl_json, u.probes_json, u.transport_json, u.version,
			u.created_at, u.updated_at,
			COALESCE(d.bound_count, 0) AS bound_domains_count
		FROM upstreams u
		LEFT JOIN (
			SELECT upstream_name AS upstream, COUNT(*) AS bound_count
			FROM routes
			GROUP BY upstream_name
		) d ON d.upstream = u.name
		WHERE u.id = ?
	)
	SELECT 
		id, name, description, architecture_type, algorithm,
		servers_json, external_fqdn, sni_override, dynamic_dns,
		internal_ssl_json, probes_json, transport_json, version,
		created_at, updated_at, bound_domains_count
	FROM target_upstream;
	`

	row := r.reader.QueryRowContext(ctx, querySQL, id)
	return scanUpstreamItem(row)
}

// GetByName lấy chi tiết upstream theo tên.
func (r *UpstreamRepository) GetByName(ctx context.Context, name string) (*entity.UpstreamItem, error) {
	const querySQL = `
	WITH target_upstream AS (
		SELECT 
			u.id, u.name, u.description, u.architecture_type, u.algorithm,
			u.servers_json, u.external_fqdn, u.sni_override, u.dynamic_dns,
			u.internal_ssl_json, u.probes_json, u.transport_json, u.version,
			u.created_at, u.updated_at,
			COALESCE(d.bound_count, 0) AS bound_domains_count
		FROM upstreams u
		LEFT JOIN (
			SELECT upstream_name AS upstream, COUNT(*) AS bound_count
			FROM routes
			GROUP BY upstream_name
		) d ON d.upstream = u.name
		WHERE u.name = ?
	)
	SELECT 
		id, name, description, architecture_type, algorithm,
		servers_json, external_fqdn, sni_override, dynamic_dns,
		internal_ssl_json, probes_json, transport_json, version,
		created_at, updated_at, bound_domains_count
	FROM target_upstream;
	`

	row := r.reader.QueryRowContext(ctx, querySQL, name)
	return scanUpstreamItem(row)
}

// List lấy danh sách upstreams theo CTE-first pattern.
func (r *UpstreamRepository) List(ctx context.Context, query entity.ListUpstreamsQuery) ([]entity.UpstreamItem, int, error) {
	limit := query.Limit
	if limit <= 0 {
		limit = 20
	}
	offset := query.Offset
	if offset < 0 {
		offset = 0
	}

	searchPattern := ""
	if query.Search != "" {
		searchPattern = "%" + query.Search + "%"
	}

	const listSQL = `
	WITH filtered_upstreams AS (
		SELECT 
			u.id, u.name, u.description, u.architecture_type, u.algorithm,
			u.servers_json, u.external_fqdn, u.sni_override, u.dynamic_dns,
			u.internal_ssl_json, u.probes_json, u.transport_json, u.version,
			u.created_at, u.updated_at,
			COALESCE(d.bound_count, 0) AS bound_domains_count
		FROM upstreams u
		LEFT JOIN (
			SELECT upstream_name AS upstream, COUNT(*) AS bound_count
			FROM routes
			GROUP BY upstream_name
		) d ON d.upstream = u.name
		WHERE (? = '' OR u.name LIKE ? OR u.description LIKE ? OR u.external_fqdn LIKE ?)
		  AND (? = '' OR u.architecture_type = ?)
	),
	total_count AS (
		SELECT COUNT(*) AS total FROM filtered_upstreams
	)
	SELECT 
		f.id, f.name, f.description, f.architecture_type, f.algorithm,
		f.servers_json, f.external_fqdn, f.sni_override, f.dynamic_dns,
		f.internal_ssl_json, f.probes_json, f.transport_json, f.version,
		f.created_at, f.updated_at, f.bound_domains_count,
		tc.total
	FROM filtered_upstreams f
	CROSS JOIN total_count tc
	ORDER BY f.id DESC
	LIMIT ? OFFSET ?;
	`

	rows, err := r.reader.QueryContext(
		ctx,
		listSQL,
		searchPattern, searchPattern, searchPattern, searchPattern,
		query.ArchitectureType, query.ArchitectureType,
		limit, offset,
	)
	if err != nil {
		return nil, 0, fmt.Errorf("query upstreams list: %w", err)
	}
	defer rows.Close()

	items := make([]entity.UpstreamItem, 0)
	total := 0

	for rows.Next() {
		var item entity.UpstreamItem
		var serversJSON, sslJSON, probesJSON, transportJSON string
		var sniOverrideInt, dynamicDNSInt int
		var itemTotal int

		err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Description,
			&item.ArchitectureType,
			&item.Algorithm,
			&serversJSON,
			&item.ExternalFQDN,
			&sniOverrideInt,
			&dynamicDNSInt,
			&sslJSON,
			&probesJSON,
			&transportJSON,
			&item.Version,
			&item.CreatedAt,
			&item.UpdatedAt,
			&item.BoundDomainsCount,
			&itemTotal,
		)
		if err != nil {
			return nil, 0, fmt.Errorf("scan upstream item: %w", err)
		}

		item.SNIOverride = (sniOverrideInt == 1)
		item.DynamicDNS = (dynamicDNSInt == 1)
		total = itemTotal

		var repoServers []repoUpstreamNode
		var repoSSL repoUpstreamInternalSSL
		var repoProbes []repoUpstreamProbe
		var repoTransport repoUpstreamTransport

		_ = json.Unmarshal([]byte(serversJSON), &repoServers)
		_ = json.Unmarshal([]byte(sslJSON), &repoSSL)
		_ = json.Unmarshal([]byte(probesJSON), &repoProbes)
		_ = json.Unmarshal([]byte(transportJSON), &repoTransport)

		item.Servers = fromRepoNodes(repoServers)
		item.InternalSSL = fromRepoInternalSSL(repoSSL)
		item.Probes = fromRepoProbes(repoProbes)
		item.Transport = fromRepoTransport(repoTransport)

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate upstream rows: %w", err)
	}

	return items, total, nil
}

// GetLatestSnapshot lấy snapshot cấu hình mới nhất cho Data Plane nodes.
func (r *UpstreamRepository) GetLatestSnapshot(ctx context.Context) (*entity.UpstreamSnapshot, error) {
	const releaseSQL = `
	SELECT release_id, digest, config_content 
	FROM upstream_releases 
	ORDER BY release_id DESC 
	LIMIT 1;
	`

	var releaseID int64
	var digest, configContent string
	err := r.reader.QueryRowContext(ctx, releaseSQL).Scan(&releaseID, &digest, &configContent)
	if err != nil {
		if err == sql.ErrNoRows {
			// Chưa có release nào được tạo
			return &entity.UpstreamSnapshot{
				ReleaseID:     0,
				Digest:        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				Upstreams:     []entity.UpstreamItem{},
				ConfigContent: "# No upstreams configured\n",
			}, nil
		}
		return nil, fmt.Errorf("query latest upstream release: %w", err)
	}

	items, _, err := r.List(ctx, entity.ListUpstreamsQuery{Limit: 1000})
	if err != nil {
		return nil, fmt.Errorf("load snapshot upstreams: %w", err)
	}

	return &entity.UpstreamSnapshot{
		ReleaseID:     releaseID,
		Digest:        digest,
		Upstreams:     items,
		ConfigContent: configContent,
	}, nil
}

// RecordNodeSync lưu nhật ký trạng thái đồng bộ từ node Data Plane.
func (r *UpstreamRepository) RecordNodeSync(
	ctx context.Context,
	nodeID string,
	releaseID int64,
	phase, message string,
) error {
	const syncSQL = `
	INSERT INTO upstream_node_sync (node_id, release_id, phase, message, updated_at)
	VALUES (?, ?, ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ','now')))
	ON CONFLICT(node_id) DO UPDATE SET
		release_id = excluded.release_id,
		phase = excluded.phase,
		message = excluded.message,
		updated_at = excluded.updated_at;
	`
	_, err := r.writer.ExecContext(ctx, syncSQL, nodeID, releaseID, phase, message)
	if err != nil {
		return fmt.Errorf("record upstream node sync: %w", err)
	}
	return nil
}

// Delete xóa upstream pool và ghi nhận snapshot release mới cho NGINX Data Plane.
func (r *UpstreamRepository) Delete(ctx context.Context, id int64, generatedConf string, digest string) error {
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// 1. Kiểm tra tồn tại
	var name string
	const checkSQL = `SELECT name FROM upstreams WHERE id = ?;`
	if err := tx.QueryRowContext(ctx, checkSQL, id).Scan(&name); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("upstream not found")
		}
		return fmt.Errorf("kiểm tra upstream: %w", err)
	}

	var bound bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM routes WHERE upstream_name = ?)`, name).Scan(&bound); err != nil {
		return err
	}
	if bound {
		return fmt.Errorf("upstream is still referenced by routes; rebind or delete those routes first")
	}
	// 2. Xóa upstream
	const deleteSQL = `DELETE FROM upstreams WHERE id = ?;`
	if _, err := tx.ExecContext(ctx, deleteSQL, id); err != nil {
		return fmt.Errorf("delete upstream: %w", err)
	}

	// 3. Ghi nhận snapshot release mới
	const insertReleaseSQL = `
	WITH next_release AS (
		SELECT COALESCE(MAX(release_id), 0) + 1 AS new_id FROM upstream_releases
	)
	INSERT INTO upstream_releases (release_id, digest, config_content)
	SELECT new_id, ?, ? FROM next_release
	RETURNING release_id;
	`
	var newReleaseID int64
	err = tx.QueryRowContext(ctx, insertReleaseSQL, digest, generatedConf).Scan(&newReleaseID)
	if err != nil {
		return fmt.Errorf("record upstream release: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

func scanUpstreamItem(scanner interface{ Scan(dest ...any) error }) (*entity.UpstreamItem, error) {
	var item entity.UpstreamItem
	var serversJSON, sslJSON, probesJSON, transportJSON string
	var sniOverrideInt, dynamicDNSInt int

	err := scanner.Scan(
		&item.ID,
		&item.Name,
		&item.Description,
		&item.ArchitectureType,
		&item.Algorithm,
		&serversJSON,
		&item.ExternalFQDN,
		&sniOverrideInt,
		&dynamicDNSInt,
		&sslJSON,
		&probesJSON,
		&transportJSON,
		&item.Version,
		&item.CreatedAt,
		&item.UpdatedAt,
		&item.BoundDomainsCount,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("scan upstream: %w", err)
	}

	item.SNIOverride = (sniOverrideInt == 1)
	item.DynamicDNS = (dynamicDNSInt == 1)

	var repoServers []repoUpstreamNode
	var repoSSL repoUpstreamInternalSSL
	var repoProbes []repoUpstreamProbe
	var repoTransport repoUpstreamTransport

	_ = json.Unmarshal([]byte(serversJSON), &repoServers)
	_ = json.Unmarshal([]byte(sslJSON), &repoSSL)
	_ = json.Unmarshal([]byte(probesJSON), &repoProbes)
	_ = json.Unmarshal([]byte(transportJSON), &repoTransport)

	item.Servers = fromRepoNodes(repoServers)
	item.InternalSSL = fromRepoInternalSSL(repoSSL)
	item.Probes = fromRepoProbes(repoProbes)
	item.Transport = fromRepoTransport(repoTransport)

	return &item, nil
}

// CalculateSHA256 tính toán mã SHA-256 dạng hex.
func CalculateSHA256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// Các struct nội bộ đại diện cho dữ liệu lưu trữ JSON trong SQLite tables:
// servers_json, transport_json, internal_ssl_json, probes_json.
// Giúp cô lập hoàn toàn tầng domain entity khỏi định dạng lưu trữ persistence.
type repoUpstreamNode struct {
	ID          string `json:"id"`
	Address     string `json:"address"`
	Weight      int    `json:"weight"`
	MaxFails    int    `json:"maxFails,omitempty"`
	FailTimeout string `json:"failTimeout,omitempty"`
	Backup      bool   `json:"backup,omitempty"`
	Healthy     bool   `json:"healthy"`
}

type repoUpstreamProbe struct {
	ID             string `json:"id"`
	Type           string `json:"type"`
	Path           string `json:"path"`
	ExpectedStatus int    `json:"expectedStatus"`
	IntervalSec    int    `json:"intervalSec,omitempty"`
	TimeoutSec     int    `json:"timeoutSec,omitempty"`
}

type repoUpstreamInternalSSL struct {
	Enabled             bool   `json:"enabled"`
	VerifyCert          bool   `json:"verifyCert"`
	SNIHost             string `json:"sniHost,omitempty"`
	CACert              string `json:"caCert,omitempty"`
	MTLS                bool   `json:"mTLS"`
	ClientCertName      string `json:"clientCertName,omitempty"`
	ClientCert          string `json:"clientCert,omitempty"`
	ClientKey           string `json:"clientKey,omitempty"`
	ClientKeyConfigured bool   `json:"clientKeyConfigured,omitempty"`
}

type repoUpstreamTransport struct {
	RequestCompression   string `json:"requestCompression"`
	CompressionMinBytes  int    `json:"compressionMinBytes"`
	CompressionLevel     int    `json:"compressionLevel"`
	HTTPVersion          string `json:"httpVersion"`
	EnableWebSocket      bool   `json:"enableWebSocket"`
	EnableSSE            bool   `json:"enableSse"`
	EnableGRPC           bool   `json:"enableGrpc"`
	KeepAliveConnections int    `json:"keepAliveConnections,omitempty"`
	KeepAliveTimeout     int    `json:"keepAliveTimeout,omitempty"`
}

func toRepoNodes(nodes []entity.UpstreamNode) []repoUpstreamNode {
	if nodes == nil {
		return []repoUpstreamNode{}
	}
	res := make([]repoUpstreamNode, len(nodes))
	for i, n := range nodes {
		res[i] = repoUpstreamNode{
			ID:          n.ID,
			Address:     n.Address,
			Weight:      n.Weight,
			MaxFails:    n.MaxFails,
			FailTimeout: n.FailTimeout,
			Backup:      n.Backup,
			Healthy:     n.Healthy,
		}
	}
	return res
}

func fromRepoNodes(nodes []repoUpstreamNode) []entity.UpstreamNode {
	if nodes == nil {
		return []entity.UpstreamNode{}
	}
	res := make([]entity.UpstreamNode, len(nodes))
	for i, n := range nodes {
		res[i] = entity.UpstreamNode{
			ID:          n.ID,
			Address:     n.Address,
			Weight:      n.Weight,
			MaxFails:    n.MaxFails,
			FailTimeout: n.FailTimeout,
			Backup:      n.Backup,
			Healthy:     n.Healthy,
		}
	}
	return res
}

func toRepoProbes(probes []entity.UpstreamProbe) []repoUpstreamProbe {
	if probes == nil {
		return []repoUpstreamProbe{}
	}
	res := make([]repoUpstreamProbe, len(probes))
	for i, p := range probes {
		res[i] = repoUpstreamProbe{
			ID:             p.ID,
			Type:           p.Type,
			Path:           p.Path,
			ExpectedStatus: p.ExpectedStatus,
			IntervalSec:    p.IntervalSec,
			TimeoutSec:     p.TimeoutSec,
		}
	}
	return res
}

func fromRepoProbes(probes []repoUpstreamProbe) []entity.UpstreamProbe {
	if probes == nil {
		return []entity.UpstreamProbe{}
	}
	res := make([]entity.UpstreamProbe, len(probes))
	for i, p := range probes {
		res[i] = entity.UpstreamProbe{
			ID:             p.ID,
			Type:           p.Type,
			Path:           p.Path,
			ExpectedStatus: p.ExpectedStatus,
			IntervalSec:    p.IntervalSec,
			TimeoutSec:     p.TimeoutSec,
		}
	}
	return res
}

func toRepoInternalSSL(ssl entity.UpstreamInternalSSL) repoUpstreamInternalSSL {
	return repoUpstreamInternalSSL{
		Enabled:             ssl.Enabled,
		VerifyCert:          ssl.VerifyCert,
		SNIHost:             ssl.SNIHost,
		CACert:              ssl.CACert,
		MTLS:                ssl.MTLS,
		ClientCertName:      ssl.ClientCertName,
		ClientCert:          ssl.ClientCert,
		ClientKey:           ssl.ClientKey,
		ClientKeyConfigured: ssl.ClientKeyConfigured,
	}
}

func fromRepoInternalSSL(ssl repoUpstreamInternalSSL) entity.UpstreamInternalSSL {
	return entity.UpstreamInternalSSL{
		Enabled:             ssl.Enabled,
		VerifyCert:          ssl.VerifyCert,
		SNIHost:             ssl.SNIHost,
		CACert:              ssl.CACert,
		MTLS:                ssl.MTLS,
		ClientCertName:      ssl.ClientCertName,
		ClientCert:          ssl.ClientCert,
		ClientKey:           ssl.ClientKey,
		ClientKeyConfigured: ssl.ClientKeyConfigured,
	}
}

func toRepoTransport(t entity.UpstreamTransport) repoUpstreamTransport {
	return repoUpstreamTransport{
		RequestCompression:   t.RequestCompression,
		CompressionMinBytes:  t.CompressionMinBytes,
		CompressionLevel:     t.CompressionLevel,
		HTTPVersion:          t.HTTPVersion,
		EnableWebSocket:      t.EnableWebSocket,
		EnableSSE:            t.EnableSSE,
		EnableGRPC:           t.EnableGRPC,
		KeepAliveConnections: t.KeepAliveConnections,
		KeepAliveTimeout:     t.KeepAliveTimeout,
	}
}

func fromRepoTransport(t repoUpstreamTransport) entity.UpstreamTransport {
	return entity.UpstreamTransport{
		RequestCompression:   t.RequestCompression,
		CompressionMinBytes:  t.CompressionMinBytes,
		CompressionLevel:     t.CompressionLevel,
		HTTPVersion:          t.HTTPVersion,
		EnableWebSocket:      t.EnableWebSocket,
		EnableSSE:            t.EnableSSE,
		EnableGRPC:           t.EnableGRPC,
		KeepAliveConnections: t.KeepAliveConnections,
		KeepAliveTimeout:     t.KeepAliveTimeout,
	}
}
