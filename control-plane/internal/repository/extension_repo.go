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

func NewExtensionRepository(writer, reader *sql.DB) repo.ExtensionRepository {
	return &sqliteExtensionRepository{writer: writer, reader: reader}
}

func (r *sqliteExtensionRepository) List(ctx context.Context, q entity.ListExtensionsQuery) ([]entity.ExtensionRecord, error) {
	const query = `
		WITH filtered_instances AS (
			SELECT id, manifest_key, manifest_version, enabled, config_json, created_at, updated_at
			FROM extension_instances
			WHERE ? = ''
			  AND (? = 'all' OR ? = '' OR (? = 'enabled' AND enabled = 1) OR (? = 'disabled' AND enabled = 0))
		)
		SELECT id, manifest_key, manifest_version, enabled, config_json, created_at, updated_at
		FROM filtered_instances
		ORDER BY manifest_key ASC, manifest_version ASC;
	`
	if q.Category != "" {
		// Categories are immutable manifest metadata. The service filters them after
		// building the instance projection, so this storage query accepts no category.
		return nil, fmt.Errorf("extension category filtering requires manifest projection")
	}
	rows, err := r.reader.QueryContext(ctx, query, q.Category, q.Status, q.Status, q.Status, q.Status)
	if err != nil {
		return nil, fmt.Errorf("query extension instances: %w", err)
	}
	defer rows.Close()

	instances := make([]entity.ExtensionRecord, 0)
	for rows.Next() {
		var record entity.ExtensionRecord
		var enabled int
		if err := rows.Scan(
			&record.ID, &record.ManifestKey, &record.ManifestVersion, &enabled,
			&record.ConfigJSON, &record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan extension instance: %w", err)
		}
		record.Enabled = enabled == 1
		instances = append(instances, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate extension instances: %w", err)
	}
	return instances, nil
}

func (r *sqliteExtensionRepository) GetByID(ctx context.Context, id string) (*entity.ExtensionRecord, error) {
	const query = `
		WITH target_instance AS (
			SELECT id, manifest_key, manifest_version, enabled, config_json, created_at, updated_at
			FROM extension_instances
			WHERE id = ?
		)
		SELECT id, manifest_key, manifest_version, enabled, config_json, created_at, updated_at
		FROM target_instance;
	`
	var record entity.ExtensionRecord
	var enabled int
	err := r.reader.QueryRowContext(ctx, query, id).Scan(
		&record.ID, &record.ManifestKey, &record.ManifestVersion, &enabled,
		&record.ConfigJSON, &record.CreatedAt, &record.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("extension instance not found: %s", id)
		}
		return nil, fmt.Errorf("query extension instance: %w", err)
	}
	record.Enabled = enabled == 1
	return &record, nil
}

func (r *sqliteExtensionRepository) UpdateStatus(ctx context.Context, cmd entity.UpdateExtensionStatusCommand) error {
	enabled := 0
	if cmd.Enabled {
		enabled = 1
	}
	result, err := r.writer.ExecContext(ctx, `
		UPDATE extension_instances
		SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?
	`, enabled, cmd.ID)
	if err != nil {
		return fmt.Errorf("update extension instance status: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check extension instance status mutation: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("extension instance not found: %s", cmd.ID)
	}
	return nil
}

func (r *sqliteExtensionRepository) UpdateConfig(ctx context.Context, cmd entity.UpdateExtensionConfigCommand) error {
	result, err := r.writer.ExecContext(ctx, `
		UPDATE extension_instances
		SET config_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		WHERE id = ?
	`, cmd.ConfigJSON, cmd.ID)
	if err != nil {
		return fmt.Errorf("update extension instance config: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check extension instance config mutation: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("extension instance not found: %s", cmd.ID)
	}
	return nil
}
