package repository

import (
	"context"
	"database/sql"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type SQLiteRouteRepository struct {
	db *sql.DB
}

func NewRouteRepository(db *sql.DB) repo.RouteRepository {
	return &SQLiteRouteRepository{db: db}
}

func (r *SQLiteRouteRepository) ListRoutes(ctx context.Context, q entity.ListRoutesQuery) (entity.ListRoutesResult, error) {
	searchPattern := "%" + q.Search + "%"

	const countQuery = `
	SELECT COUNT(*)
	FROM routes
	WHERE (? = '%%' OR name LIKE ? OR host LIKE ? OR path LIKE ? OR description LIKE ?)
	  AND (? = '' OR host = ?)
	  AND (? = '' OR upstream_name = ?)
	`

	var total int
	if err := r.db.QueryRowContext(ctx, countQuery,
		searchPattern, searchPattern, searchPattern, searchPattern, searchPattern,
		q.Host, q.Host,
		q.UpstreamName, q.UpstreamName,
	).Scan(&total); err != nil {
		return entity.ListRoutesResult{}, fmt.Errorf("count routes: %w", err)
	}

	const listQuery = `
	SELECT 
		id, name, host, path, upstream_name, enabled,
		strip_path, websocket, priority, plugins_json,
		description, created_at, updated_at
	FROM routes
	WHERE (? = '%%' OR name LIKE ? OR host LIKE ? OR path LIKE ? OR description LIKE ?)
	  AND (? = '' OR host = ?)
	  AND (? = '' OR upstream_name = ?)
	ORDER BY priority DESC, created_at DESC
	LIMIT ? OFFSET ?
	`

	rows, err := r.db.QueryContext(ctx, listQuery,
		searchPattern, searchPattern, searchPattern, searchPattern, searchPattern,
		q.Host, q.Host,
		q.UpstreamName, q.UpstreamName,
		q.Limit, q.Offset,
	)
	if err != nil {
		return entity.ListRoutesResult{}, fmt.Errorf("list routes: %w", err)
	}
	defer rows.Close()

	items := make([]entity.RouteItem, 0, q.Limit)
	for rows.Next() {
		var item entity.RouteItem
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Host,
			&item.Path,
			&item.UpstreamName,
			&item.Enabled,
			&item.StripPath,
			&item.WebSocket,
			&item.Priority,
			&item.PluginsJSON,
			&item.Description,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return entity.ListRoutesResult{}, fmt.Errorf("scan route: %w", err)
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return entity.ListRoutesResult{}, fmt.Errorf("iterate routes: %w", err)
	}

	return entity.ListRoutesResult{
		Items: items,
		Total: total,
	}, nil
}

func (r *SQLiteRouteRepository) GetRouteByID(ctx context.Context, id string) (*entity.RouteItem, error) {
	const query = `
	SELECT 
		id, name, host, path, upstream_name, enabled,
		strip_path, websocket, priority, plugins_json,
		description, created_at, updated_at
	FROM routes
	WHERE id = ?
	`
	var item entity.RouteItem
	if err := r.db.QueryRowContext(ctx, query, id).Scan(
		&item.ID,
		&item.Name,
		&item.Host,
		&item.Path,
		&item.UpstreamName,
		&item.Enabled,
		&item.StripPath,
		&item.WebSocket,
		&item.Priority,
		&item.PluginsJSON,
		&item.Description,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get route by id %q: %w", id, err)
	}
	return &item, nil
}

func (r *SQLiteRouteRepository) CreateRoute(ctx context.Context, cmd entity.CreateRouteCommand) error {
	const query = `
	WITH upstream_authority AS (
		SELECT name FROM upstreams WHERE name = ?
	)
	INSERT INTO routes (
		id, name, host, path, upstream_name, enabled,
		strip_path, websocket, priority, plugins_json, description
	)
	SELECT ?, ?, ?, ?, u.name, ?, ?, ?, ?, ?, ?
	FROM upstream_authority u
	`

	res, err := r.db.ExecContext(ctx, query,
		cmd.UpstreamName,
		cmd.ID,
		cmd.Name,
		cmd.Host,
		cmd.Path,
		cmd.Enabled,
		cmd.StripPath,
		cmd.WebSocket,
		cmd.Priority,
		cmd.PluginsJSON,
		cmd.Description,
	)
	if err != nil {
		return fmt.Errorf("insert route %q: %w", cmd.ID, err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("upstream %q không tồn tại", cmd.UpstreamName)
	}
	return nil
}

func (r *SQLiteRouteRepository) UpdateRoute(ctx context.Context, cmd entity.UpdateRouteCommand) error {
	const query = `
	WITH target_route AS (
		SELECT id FROM routes WHERE id = ?
	),
	upstream_authority AS (
		SELECT name FROM upstreams WHERE name = ?
	)
	UPDATE routes SET
		name = ?,
		host = ?,
		path = ?,
		upstream_name = (SELECT name FROM upstream_authority),
		enabled = ?,
		strip_path = ?,
		websocket = ?,
		priority = ?,
		plugins_json = ?,
		description = ?,
		updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	WHERE id = (SELECT id FROM target_route)
	  AND EXISTS (SELECT 1 FROM upstream_authority)
	`

	res, err := r.db.ExecContext(ctx, query,
		cmd.ID,
		cmd.UpstreamName,
		cmd.Name,
		cmd.Host,
		cmd.Path,
		cmd.Enabled,
		cmd.StripPath,
		cmd.WebSocket,
		cmd.Priority,
		cmd.PluginsJSON,
		cmd.Description,
	)
	if err != nil {
		return fmt.Errorf("update route %q: %w", cmd.ID, err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		var upCount int
		if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM upstreams WHERE name = ?", cmd.UpstreamName).Scan(&upCount); err == nil && upCount == 0 {
			return fmt.Errorf("upstream %q không tồn tại", cmd.UpstreamName)
		}
		return fmt.Errorf("route %q not found", cmd.ID)
	}
	return nil
}

func (r *SQLiteRouteRepository) DeleteRoute(ctx context.Context, id string) error {
	const query = `DELETE FROM routes WHERE id = ?`
	res, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete route %q: %w", id, err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("route %q not found", id)
	}
	return nil
}

func (r *SQLiteRouteRepository) ToggleRouteStatus(ctx context.Context, id string, enabled bool) error {
	const query = `
	UPDATE routes SET
		enabled = ?,
		updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	WHERE id = ?
	`
	res, err := r.db.ExecContext(ctx, query, enabled, id)
	if err != nil {
		return fmt.Errorf("toggle route %q status: %w", id, err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("route %q not found", id)
	}
	return nil
}

func (r *SQLiteRouteRepository) GetAllActiveRoutes(ctx context.Context) ([]entity.RouteItem, error) {
	const query = `
	SELECT 
		id, name, host, path, upstream_name, enabled,
		strip_path, websocket, priority, plugins_json,
		description, created_at, updated_at
	FROM routes
	WHERE enabled = 1
	ORDER BY priority DESC, length(path) DESC
	`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("get all active routes: %w", err)
	}
	defer rows.Close()

	items := make([]entity.RouteItem, 0)
	for rows.Next() {
		var item entity.RouteItem
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Host,
			&item.Path,
			&item.UpstreamName,
			&item.Enabled,
			&item.StripPath,
			&item.WebSocket,
			&item.Priority,
			&item.PluginsJSON,
			&item.Description,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan active route: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
