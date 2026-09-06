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
