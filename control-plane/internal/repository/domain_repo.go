package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type DomainRepository struct {
	writer *sql.DB
	reader *sql.DB
}

func NewDomainRepository(writer, reader *sql.DB) repo.DomainRepository {
	return &DomainRepository{
		writer: writer,
		reader: reader,
	}
}

// ListDomains truy vấn danh sách Domain theo CTE-first pattern.
// Query biểu diễn global counts, filtered target, count và pagination trong một luồng mạch lạc.
func (r *DomainRepository) ListDomains(ctx context.Context, q entity.ListDomainsQuery) (entity.ListDomainsResult, error) {
	result := entity.ListDomainsResult{
		Items: []entity.ListDomainsItem{},
		Counts: entity.ListDomainsCounts{
			Total:       0,
			Active:      0,
			Inactive:    0,
			MTLSEnabled: 0,
		},
		TotalFiltered: 0,
	}

	limit := q.Limit
	if limit <= 0 {
		limit = 10
	}
	offset := q.Offset
	if offset < 0 {
		offset = 0
	}

	searchPattern := ""
	if q.Search != "" {
		searchPattern = "%" + q.Search + "%"
	}

	tagPattern := ""
	if q.Tag != "" && q.Tag != "ALL" {
		tagPattern = "%\"" + q.Tag + "\"%"
	}

	statusFilter := q.Status
	if statusFilter == "ALL" {
		statusFilter = ""
	}

	tlsFilter := q.TLSType
	if tlsFilter == "ALL" {
		tlsFilter = ""
	}

	// CTE 1: Lấy global stats độc lập với bộ lọc hiện tại
	const statsQuery = `
	WITH global_stats AS (
		SELECT
			COUNT(*) AS total_count,
			COALESCE(SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END), 0) AS active_count,
			COALESCE(SUM(CASE WHEN status = 'Inactive' THEN 1 ELSE 0 END), 0) AS inactive_count,
			COALESCE(SUM(CASE WHEN tls_type = 'mTLS' THEN 1 ELSE 0 END), 0) AS mtls_count
		FROM domains
	)
	SELECT total_count, active_count, inactive_count, mtls_count FROM global_stats;
	`
	if err := r.reader.QueryRowContext(ctx, statsQuery).Scan(
		&result.Counts.Total,
		&result.Counts.Active,
		&result.Counts.Inactive,
		&result.Counts.MTLSEnabled,
	); err != nil && err != sql.ErrNoRows {
		return result, fmt.Errorf("query domain global stats: %w", err)
	}

	// CTE 2 & 3: Filter & Page records
	const listQuery = `
	WITH filtered AS (
		SELECT
			id,
			domain,
			root_domain,
			status,
			tls_type,
			tls_expiry,
			tls_auto_renew,
			min_tls_version,
			hsts_enabled,
			ocsp_stapling,
			client_ca_subject,
			upstream,
			upstream_algorithm,
			health_check_path,
			tags_json,
			description,
			created_by,
			created_at,
			updated_at,
			COUNT(*) OVER() AS total_filtered_count
		FROM domains
		WHERE (? = '' OR domain LIKE ? OR root_domain LIKE ? OR upstream LIKE ? OR tags_json LIKE ?)
		  AND (? = '' OR status = ?)
		  AND (? = '' OR tls_type = ?)
		  AND (? = '' OR tags_json LIKE ?)
		ORDER BY id ASC
		LIMIT ? OFFSET ?
	)
	SELECT
		id,
		domain,
		root_domain,
		status,
		tls_type,
		tls_expiry,
		tls_auto_renew,
		min_tls_version,
		hsts_enabled,
		ocsp_stapling,
		client_ca_subject,
		upstream,
		upstream_algorithm,
		health_check_path,
		tags_json,
		description,
		created_by,
		created_at,
		updated_at,
		total_filtered_count
	FROM filtered;
	`

	rows, err := r.reader.QueryContext(
		ctx,
		listQuery,
		searchPattern, searchPattern, searchPattern, searchPattern, searchPattern,
		statusFilter, statusFilter,
		tlsFilter, tlsFilter,
		tagPattern, tagPattern,
		limit, offset,
	)
	if err != nil {
		return result, fmt.Errorf("query domains: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var item entity.ListDomainsItem
		var tagsJSON string
		var totalFiltered int
		var autoRenewInt, hstsInt, ocspInt int

		if err := rows.Scan(
			&item.ID,
			&item.Domain,
			&item.RootDomain,
			&item.Status,
			&item.TLSType,
			&item.TLSExpiry,
			&autoRenewInt,
			&item.MinTLSVersion,
			&hstsInt,
			&ocspInt,
			&item.ClientCASubject,
			&item.Upstream,
			&item.UpstreamAlgorithm,
			&item.HealthCheckPath,
			&tagsJSON,
			&item.Description,
			&item.CreatedBy,
			&item.CreatedAt,
			&item.UpdatedAt,
			&totalFiltered,
		); err != nil {
			return result, fmt.Errorf("scan domain item: %w", err)
		}

		item.TLSAutoRenew = autoRenewInt == 1
		item.HSTSEnabled = hstsInt == 1
		item.OCSPStapling = ocspInt == 1

		var tags []string
		if tagsJSON != "" {
			_ = json.Unmarshal([]byte(tagsJSON), &tags)
		}
		if tags == nil {
			tags = []string{}
		}
		item.Tags = tags

		// Gán số lượng rule/policy thống kê mặc định (có thể join sau khi có bảng binding quan hệ)
		item.RulesCount = 3
		item.PoliciesCount = 1
		item.IPRulesCount = 1
		item.RateLimitsCount = 1

		result.TotalFiltered = totalFiltered
		result.Items = append(result.Items, item)
	}

	if err := rows.Err(); err != nil {
		return result, fmt.Errorf("iterate domain rows: %w", err)
	}

	return result, nil
}

// DomainCatalog truy vấn danh sách Domain tinh gọn cho catalog selection bằng CTE-first pattern.
func (r *DomainRepository) DomainCatalog(ctx context.Context) ([]entity.DomainCatalogItem, error) {
	const query = `
	WITH catalog_domains AS (
		SELECT id, domain, root_domain, status, upstream
		FROM domains
		ORDER BY domain ASC
	)
	SELECT id, domain, root_domain, status, upstream FROM catalog_domains;
	`
	rows, err := r.reader.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query domain catalog: %w", err)
	}
	defer rows.Close()

	items := make([]entity.DomainCatalogItem, 0)
	for rows.Next() {
		var it entity.DomainCatalogItem
		if err := rows.Scan(&it.ID, &it.Domain, &it.RootDomain, &it.Status, &it.Upstream); err != nil {
			return nil, fmt.Errorf("scan domain catalog item: %w", err)
		}
		items = append(items, it)
	}
	return items, rows.Err()
}

// Create chèn một domain mới vào database.
func (r *DomainRepository) Create(ctx context.Context, cmd entity.CreateDomainCommand) (int64, error) {
	tagsJSON, err := json.Marshal(cmd.Tags)
	if err != nil {
		tagsJSON = []byte("[]")
	}

	hstsInt := 0
	if cmd.HSTSEnabled {
		hstsInt = 1
	}
	ocspInt := 0
	if cmd.OCSPStapling {
		ocspInt = 1
	}

	const insertQuery = `
	INSERT INTO domains (
		domain, root_domain, status, tls_type, min_tls_version,
		hsts_enabled, ocsp_stapling, client_ca_subject, upstream,
		upstream_algorithm, health_check_path, tags_json, description, created_by
	) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
 WHERE (? LIKE 'http://%' OR ? LIKE 'https://%' OR EXISTS (SELECT 1 FROM upstreams WHERE name = ?))
	`
	res, err := r.writer.ExecContext(
		ctx,
		insertQuery,
		cmd.Domain, cmd.RootDomain, cmd.Status, cmd.TLSType, cmd.MinTLSVersion,
		hstsInt, ocspInt, cmd.ClientCASubject, cmd.Upstream,
		cmd.UpstreamAlgorithm, cmd.HealthCheckPath, string(tagsJSON), cmd.Description, cmd.CreatedBy,
		cmd.Upstream, cmd.Upstream, cmd.Upstream,
	)
	if err != nil {
		return 0, fmt.Errorf("insert domain: %w", err)
	}
	if n, e := res.RowsAffected(); e != nil || n == 0 {
		return 0, fmt.Errorf("upstream pool does not exist")
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, fmt.Errorf("get last insert id: %w", err)
	}
	return id, nil
}

// GetByID truy vấn chi tiết một domain theo ID.
func (r *DomainRepository) GetByID(ctx context.Context, id int64) (*entity.ListDomainsItem, error) {
	const query = `
	SELECT
		id, domain, root_domain, status, tls_type, tls_expiry, tls_auto_renew,
		min_tls_version, hsts_enabled, ocsp_stapling, client_ca_subject, upstream,
		upstream_algorithm, health_check_path, tags_json, description,
		created_by, created_at, updated_at
	FROM domains
	WHERE id = ?;
	`
	var item entity.ListDomainsItem
	var tagsJSON string
	var autoRenewInt, hstsInt, ocspInt int

	err := r.reader.QueryRowContext(ctx, query, id).Scan(
		&item.ID,
		&item.Domain,
		&item.RootDomain,
		&item.Status,
		&item.TLSType,
		&item.TLSExpiry,
		&autoRenewInt,
		&item.MinTLSVersion,
		&hstsInt,
		&ocspInt,
		&item.ClientCASubject,
		&item.Upstream,
		&item.UpstreamAlgorithm,
		&item.HealthCheckPath,
		&tagsJSON,
		&item.Description,
		&item.CreatedBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query domain by id: %w", err)
	}

	item.TLSAutoRenew = autoRenewInt == 1
	item.HSTSEnabled = hstsInt == 1
	item.OCSPStapling = ocspInt == 1

	var tags []string
	if tagsJSON != "" {
		_ = json.Unmarshal([]byte(tagsJSON), &tags)
	}
	if tags == nil {
		tags = []string{}
	}
	item.Tags = tags
	item.RulesCount = 0
	item.PoliciesCount = 0
	item.IPRulesCount = 0
	item.RateLimitsCount = 0

	return &item, nil
}

// Update cập nhật một domain theo ID.
func (r *DomainRepository) Update(ctx context.Context, id int64, cmd entity.UpdateDomainCommand) error {
	tagsJSON, err := json.Marshal(cmd.Tags)
	if err != nil {
		tagsJSON = []byte("[]")
	}

	hstsInt := 0
	if cmd.HSTSEnabled {
		hstsInt = 1
	}
	ocspInt := 0
	if cmd.OCSPStapling {
		ocspInt = 1
	}

	const updateQuery = `
	UPDATE domains
	SET status = ?,
	    tls_type = ?,
	    min_tls_version = ?,
	    hsts_enabled = ?,
	    ocsp_stapling = ?,
	    client_ca_subject = ?,
	    upstream = ?,
	    upstream_algorithm = ?,
	    health_check_path = ?,
	    tags_json = ?,
	    description = ?,
	    updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	WHERE id = ? AND (? LIKE 'http://%' OR ? LIKE 'https://%' OR EXISTS (SELECT 1 FROM upstreams WHERE name = ?));
	`
	res, err := r.writer.ExecContext(
		ctx,
		updateQuery,
		cmd.Status,
		cmd.TLSType,
		cmd.MinTLSVersion,
		hstsInt,
		ocspInt,
		cmd.ClientCASubject,
		cmd.Upstream,
		cmd.UpstreamAlgorithm,
		cmd.HealthCheckPath,
		string(tagsJSON),
		cmd.Description,
		id, cmd.Upstream, cmd.Upstream, cmd.Upstream,
	)
	if err != nil {
		return fmt.Errorf("update domain: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("domain not found or upstream pool does not exist")
	}
	return nil
}

// Delete xoá một domain theo ID.
func (r *DomainRepository) Delete(ctx context.Context, id int64) error {
	const deleteQuery = `DELETE FROM domains WHERE id = ?;`
	res, err := r.writer.ExecContext(ctx, deleteQuery, id)
	if err != nil {
		return fmt.Errorf("delete domain: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if affected == 0 {
		return fmt.Errorf("domain not found")
	}
	return nil
}
