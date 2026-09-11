package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
)

type sqliteL4Repository struct {
	writer *sql.DB
	reader *sql.DB
}

// NewL4Repository tạo mới L4 repository instance (tuân thủ CTE-first).
func NewL4Repository(writer *sql.DB, reader *sql.DB) repo.L4Repository {
	return &sqliteL4Repository{
		writer: writer,
		reader: reader,
	}
}

// ─── L4 SERVICE REPOSITORY (CTE-FIRST) ──────────────────────────────────────────

func (r *sqliteL4Repository) ListServices(ctx context.Context, q entity.ListL4ServicesQuery) ([]entity.L4ServiceItem, int, error) {
	var whereClauses []string
	var args []interface{}

	if strings.TrimSpace(q.Search) != "" {
		s := "%" + strings.TrimSpace(q.Search) + "%"
		whereClauses = append(whereClauses, "(s.name LIKE ? OR s.upstream_name LIKE ? OR s.direct_endpoint LIKE ? OR s.description LIKE ?)")
		args = append(args, s, s, s, s)
	}

	if strings.TrimSpace(q.Protocol) != "" && strings.ToLower(q.Protocol) != "all" {
		whereClauses = append(whereClauses, "s.protocol = ?")
		args = append(args, strings.ToLower(strings.TrimSpace(q.Protocol)))
	}

	whereSQL := ""
	if len(whereClauses) > 0 {
		whereSQL = "WHERE " + strings.Join(whereClauses, " AND ")
	}

	countQuery := fmt.Sprintf(`
	WITH target_services AS (
		SELECT s.id
		FROM l4_services s
		%s
	)
	SELECT count(*) FROM target_services;
	`, whereSQL)

	var total int
	if err := r.reader.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count l4 services: %w", err)
	}

	queryArgs := append(args, q.Limit, q.Offset)
	dataQuery := fmt.Sprintf(`
	WITH paged_services AS (
		SELECT 
			s.id,
			s.name,
			s.protocol,
			s.listen_port,
			s.forward_target_type,
			s.upstream_name,
			s.direct_endpoint,
			s.acl_rules_json,
			s.proxy_timeout,
			s.proxy_connect_timeout,
			s.enabled,
			s.description,
			s.created_at,
			s.updated_at
		FROM l4_services s
		%s
		ORDER BY s.listen_port ASC
		LIMIT ? OFFSET ?
	)
	SELECT 
		id, name, protocol, listen_port, forward_target_type, upstream_name, direct_endpoint,
		acl_rules_json, proxy_timeout, proxy_connect_timeout, enabled, description, created_at, updated_at
	FROM paged_services;
	`, whereSQL)

	rows, err := r.reader.QueryContext(ctx, dataQuery, queryArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("query l4 services: %w", err)
	}
	defer rows.Close()

	var items []entity.L4ServiceItem
	for rows.Next() {
		var it entity.L4ServiceItem
		var enabledInt int
		if err := rows.Scan(
			&it.ID,
			&it.Name,
			&it.Protocol,
			&it.ListenPort,
			&it.ForwardTargetType,
			&it.UpstreamName,
			&it.DirectEndpoint,
			&it.ACLRulesJSON,
			&it.ProxyTimeout,
			&it.ProxyConnectTimeout,
			&enabledInt,
			&it.Description,
			&it.CreatedAt,
			&it.UpdatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan l4 service row: %w", err)
		}
		it.Enabled = enabledInt == 1
		items = append(items, it)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate l4 services: %w", err)
	}

	return items, total, nil
}

func (r *sqliteL4Repository) GetServiceByID(ctx context.Context, id string) (*entity.L4ServiceItem, error) {
	const query = `
	WITH single_service AS (
		SELECT 
			s.id,
			s.name,
			s.protocol,
			s.listen_port,
			s.forward_target_type,
			s.upstream_name,
			s.direct_endpoint,
			s.acl_rules_json,
			s.proxy_timeout,
			s.proxy_connect_timeout,
			s.enabled,
			s.description,
			s.created_at,
			s.updated_at
		FROM l4_services s
		WHERE s.id = ?
	)
	SELECT 
		id, name, protocol, listen_port, forward_target_type, upstream_name, direct_endpoint,
		acl_rules_json, proxy_timeout, proxy_connect_timeout, enabled, description, created_at, updated_at
	FROM single_service;
	`
	var it entity.L4ServiceItem
	var enabledInt int
	err := r.reader.QueryRowContext(ctx, query, id).Scan(
		&it.ID,
		&it.Name,
		&it.Protocol,
		&it.ListenPort,
		&it.ForwardTargetType,
		&it.UpstreamName,
		&it.DirectEndpoint,
		&it.ACLRulesJSON,
		&it.ProxyTimeout,
		&it.ProxyConnectTimeout,
		&enabledInt,
		&it.Description,
		&it.CreatedAt,
		&it.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, taxonomy.ErrL4ServiceNotFound
		}
		return nil, fmt.Errorf("get l4 service by id: %w", err)
	}
	it.Enabled = enabledInt == 1
	return &it, nil
}

func (r *sqliteL4Repository) GetServiceByPortProto(ctx context.Context, protocol string, port int) (*entity.L4ServiceItem, error) {
	const query = `
	WITH service_by_port AS (
		SELECT 
			s.id,
			s.name,
			s.protocol,
			s.listen_port,
			s.forward_target_type,
			s.upstream_name,
			s.direct_endpoint,
			s.acl_rules_json,
			s.proxy_timeout,
			s.proxy_connect_timeout,
			s.enabled,
			s.description,
			s.created_at,
			s.updated_at
		FROM l4_services s
		WHERE s.protocol = ? AND s.listen_port = ?
	)
	SELECT 
		id, name, protocol, listen_port, forward_target_type, upstream_name, direct_endpoint,
		acl_rules_json, proxy_timeout, proxy_connect_timeout, enabled, description, created_at, updated_at
	FROM service_by_port;
	`
	var it entity.L4ServiceItem
	var enabledInt int
	err := r.reader.QueryRowContext(ctx, query, strings.ToLower(protocol), port).Scan(
		&it.ID,
		&it.Name,
		&it.Protocol,
		&it.ListenPort,
		&it.ForwardTargetType,
		&it.UpstreamName,
		&it.DirectEndpoint,
		&it.ACLRulesJSON,
		&it.ProxyTimeout,
		&it.ProxyConnectTimeout,
		&enabledInt,
		&it.Description,
		&it.CreatedAt,
		&it.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get l4 service by port/proto: %w", err)
	}
	it.Enabled = enabledInt == 1
	return &it, nil
}

func (r *sqliteL4Repository) CreateService(ctx context.Context, c entity.CreateL4ServiceCommand) (*entity.L4ServiceItem, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	enabledInt := 0
	if c.Enabled {
		enabledInt = 1
	}

	const insertQuery = `
	INSERT INTO l4_services (
		id, name, protocol, listen_port, forward_target_type, upstream_name, direct_endpoint,
		acl_rules_json, proxy_timeout, proxy_connect_timeout, enabled, description, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
	`

	_, err := r.writer.ExecContext(
		ctx,
		insertQuery,
		c.ID,
		c.Name,
		c.Protocol,
		c.ListenPort,
		c.ForwardTargetType,
		c.UpstreamName,
		c.DirectEndpoint,
		c.ACLRulesJSON,
		c.ProxyTimeout,
		c.ProxyConnectTimeout,
		enabledInt,
		c.Description,
		now,
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("insert l4 service: %w", err)
	}

	return r.GetServiceByID(ctx, c.ID)
}

func (r *sqliteL4Repository) UpdateService(ctx context.Context, c entity.UpdateL4ServiceCommand) (*entity.L4ServiceItem, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	enabledInt := 0
	if c.Enabled {
		enabledInt = 1
	}

	const updateQuery = `
	UPDATE l4_services
	SET 
		name = ?,
		protocol = ?,
		listen_port = ?,
		forward_target_type = ?,
		upstream_name = ?,
		direct_endpoint = ?,
		acl_rules_json = ?,
		proxy_timeout = ?,
		proxy_connect_timeout = ?,
		enabled = ?,
		description = ?,
		updated_at = ?
	WHERE id = ?;
	`

	res, err := r.writer.ExecContext(
		ctx,
		updateQuery,
		c.Name,
		c.Protocol,
		c.ListenPort,
		c.ForwardTargetType,
		c.UpstreamName,
		c.DirectEndpoint,
		c.ACLRulesJSON,
		c.ProxyTimeout,
		c.ProxyConnectTimeout,
		enabledInt,
		c.Description,
		now,
		c.ID,
	)
	if err != nil {
		return nil, fmt.Errorf("update l4 service: %w", err)
	}

	rowsAff, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if rowsAff == 0 {
		return nil, taxonomy.ErrL4ServiceNotFound
	}

	return r.GetServiceByID(ctx, c.ID)
}

func (r *sqliteL4Repository) DeleteService(ctx context.Context, id string) error {
	const deleteQuery = `
	DELETE FROM l4_services WHERE id = ?;
	`
	res, err := r.writer.ExecContext(ctx, deleteQuery, id)
	if err != nil {
		return fmt.Errorf("delete l4 service: %w", err)
	}
	rowsAff, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAff == 0 {
		return taxonomy.ErrL4ServiceNotFound
	}
	return nil
}

func (r *sqliteL4Repository) CountServicesByUpstreamName(ctx context.Context, upstreamName string) (int, error) {
	const query = `
	SELECT count(*) FROM l4_services WHERE upstream_name = ? AND forward_target_type = 'upstream';
	`
	var count int
	if err := r.reader.QueryRowContext(ctx, query, upstreamName).Scan(&count); err != nil {
		return 0, fmt.Errorf("count l4 services by upstream name: %w", err)
	}
	return count, nil
}

func (r *sqliteL4Repository) GetAllActiveServices(ctx context.Context) ([]entity.L4ServiceItem, error) {
	const query = `
	SELECT 
		id, name, protocol, listen_port, forward_target_type, upstream_name, direct_endpoint,
		acl_rules_json, proxy_timeout, proxy_connect_timeout, enabled, description, created_at, updated_at
	FROM l4_services
	WHERE enabled = 1
	ORDER BY listen_port ASC;
	`
	rows, err := r.reader.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("get all active l4 services: %w", err)
	}
	defer rows.Close()

	var items []entity.L4ServiceItem
	for rows.Next() {
		var it entity.L4ServiceItem
		var enabledInt int
		if err := rows.Scan(
			&it.ID,
			&it.Name,
			&it.Protocol,
			&it.ListenPort,
			&it.ForwardTargetType,
			&it.UpstreamName,
			&it.DirectEndpoint,
			&it.ACLRulesJSON,
			&it.ProxyTimeout,
			&it.ProxyConnectTimeout,
			&enabledInt,
			&it.Description,
			&it.CreatedAt,
			&it.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan active l4 service: %w", err)
		}
		it.Enabled = enabledInt == 1
		items = append(items, it)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active l4 services: %w", err)
	}

	return items, nil
}
