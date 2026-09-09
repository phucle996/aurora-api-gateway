package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type sqliteExtensionRepository struct {
	writer *sql.DB
	reader *sql.DB
}

// NewExtensionRepository creates a new ExtensionRepository instance.
func NewExtensionRepository(writer, reader *sql.DB) repo.ExtensionRepository {
	return &sqliteExtensionRepository{
		writer: writer,
		reader: reader,
	}
}

func (r *sqliteExtensionRepository) List(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
	const query = `
		WITH filtered_extensions AS (
			SELECT 
				id, name, category, description, version, enabled, 
				config_json, schema_json, is_builtin, created_at, updated_at
			FROM extensions
			WHERE (
				(? = '' OR category = ?)
				AND (
					? = 'all' OR ? = ''
					OR (? = 'enabled' AND enabled = 1)
					OR (? = 'disabled' AND enabled = 0)
				)
			)
		)
		SELECT id, name, category, description, version, enabled, 
		       config_json, schema_json, is_builtin, created_at, updated_at
		FROM filtered_extensions
		ORDER BY category ASC, id ASC;
	`

	rows, err := r.reader.QueryContext(ctx, query, q.Category, q.Category, q.Status, q.Status, q.Status, q.Status)
	if err != nil {
		return nil, fmt.Errorf("query extensions failed: %w", err)
	}
	defer rows.Close()

	var list []entity.ExtensionRecord
	for rows.Next() {
		var rec entity.ExtensionRecord
		var enabledInt, builtinInt int
		if err := rows.Scan(
			&rec.ID,
			&rec.Name,
			&rec.Category,
			&rec.Description,
			&rec.Version,
			&enabledInt,
			&rec.ConfigJSON,
			&rec.SchemaJSON,
			&builtinInt,
			&rec.CreatedAt,
			&rec.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan extension record failed: %w", err)
		}
		rec.Enabled = enabledInt == 1
		rec.IsBuiltin = builtinInt == 1
		list = append(list, rec)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate extensions failed: %w", err)
	}

	return list, nil
}

func (r *sqliteExtensionRepository) GetByID(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
	const query = `
		WITH target_extension AS (
			SELECT 
				id, name, category, description, version, enabled, 
				config_json, schema_json, is_builtin, created_at, updated_at
			FROM extensions
			WHERE id = ?
		)
		SELECT id, name, category, description, version, enabled, 
		       config_json, schema_json, is_builtin, created_at, updated_at
		FROM target_extension;
	`

	var rec entity.ExtensionRecord
	var enabledInt, builtinInt int
	err := r.reader.QueryRowContext(ctx, query, id).Scan(
		&rec.ID,
		&rec.Name,
		&rec.Category,
		&rec.Description,
		&rec.Version,
		&enabledInt,
		&rec.ConfigJSON,
		&rec.SchemaJSON,
		&builtinInt,
		&rec.CreatedAt,
		&rec.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("extension not found: %s", id)
		}
		return nil, fmt.Errorf("query extension by id failed: %w", err)
	}
	rec.Enabled = enabledInt == 1
	rec.IsBuiltin = builtinInt == 1

	return &rec, nil
}

func (r *sqliteExtensionRepository) UpdateStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
	const query = `
		UPDATE extensions
		SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?;
	`

	enabledInt := 0
	if cmd.Enabled {
		enabledInt = 1
	}

	res, err := r.writer.ExecContext(ctx, query, enabledInt, cmd.ID)
	if err != nil {
		return fmt.Errorf("update extension status failed: %w", err)
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected failed: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("extension not found: %s", cmd.ID)
	}

	return nil
}

func (r *sqliteExtensionRepository) UpdateConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
	const query = `
		UPDATE extensions
		SET config_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?;
	`

	res, err := r.writer.ExecContext(ctx, query, cmd.ConfigJSON, cmd.ID)
	if err != nil {
		return fmt.Errorf("update extension config failed: %w", err)
	}

	rows, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check rows affected failed: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("extension not found: %s", cmd.ID)
	}

	return nil
}
