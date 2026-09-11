package repository

import (
	"context"
	"database/sql"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type SQLiteCertificateRepository struct {
	db *sql.DB
}

func NewSQLiteCertificateRepository(db *sql.DB) repo.CertificateRepository {
	return &SQLiteCertificateRepository{db: db}
}

func (r *SQLiteCertificateRepository) ListCertificates(ctx context.Context, q entity.ListCertificatesQuery) (entity.ListCertificatesResult, error) {
	searchPattern := "%" + q.Search + "%"

	const countQuery = `
	SELECT COUNT(*)
	FROM ssl_certificates
	WHERE (? = '%%' OR name LIKE ? OR snis_json LIKE ? OR description LIKE ?)
	`

	var total int
	if err := r.db.QueryRowContext(ctx, countQuery, searchPattern, searchPattern, searchPattern, searchPattern).Scan(&total); err != nil {
		return entity.ListCertificatesResult{}, fmt.Errorf("count certificates: %w", err)
	}

	const listQuery = `
	SELECT 
		id, name, snis_json, cert_pem, key_pem, mtls_enabled,
		client_ca_pem, verify_depth, enabled, description,
		created_at, updated_at
	FROM ssl_certificates
	WHERE (? = '%%' OR name LIKE ? OR snis_json LIKE ? OR description LIKE ?)
	ORDER BY created_at DESC
	LIMIT ? OFFSET ?
	`

	rows, err := r.db.QueryContext(ctx, listQuery, searchPattern, searchPattern, searchPattern, searchPattern, q.Limit, q.Offset)
	if err != nil {
		return entity.ListCertificatesResult{}, fmt.Errorf("list certificates: %w", err)
	}
	defer rows.Close()

	items := make([]entity.CertificateItem, 0, q.Limit)
	for rows.Next() {
		var item entity.CertificateItem
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.SNIsJSON,
			&item.CertPEM,
			&item.KeyPEM,
			&item.MTLSEnabled,
			&item.ClientCAPEM,
			&item.VerifyDepth,
			&item.Enabled,
			&item.Description,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return entity.ListCertificatesResult{}, fmt.Errorf("scan certificate: %w", err)
		}
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return entity.ListCertificatesResult{}, fmt.Errorf("iterate certificates: %w", err)
	}

	return entity.ListCertificatesResult{
		Items: items,
		Total: total,
	}, nil
}

func (r *SQLiteCertificateRepository) GetCertificateByID(ctx context.Context, id string) (*entity.CertificateItem, error) {
	const query = `
	SELECT 
		id, name, snis_json, cert_pem, key_pem, mtls_enabled,
		client_ca_pem, verify_depth, enabled, description,
		created_at, updated_at
	FROM ssl_certificates
	WHERE id = ?
	`
	var item entity.CertificateItem
	if err := r.db.QueryRowContext(ctx, query, id).Scan(
		&item.ID,
		&item.Name,
		&item.SNIsJSON,
		&item.CertPEM,
		&item.KeyPEM,
		&item.MTLSEnabled,
		&item.ClientCAPEM,
		&item.VerifyDepth,
		&item.Enabled,
		&item.Description,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get certificate by id %q: %w", id, err)
	}
	return &item, nil
}

func (r *SQLiteCertificateRepository) CreateCertificate(ctx context.Context, cmd entity.CreateCertificateCommand) error {
	const query = `
	INSERT INTO ssl_certificates (
		id, name, snis_json, cert_pem, key_pem, mtls_enabled,
		client_ca_pem, verify_depth, enabled, description
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err := r.db.ExecContext(ctx, query,
		cmd.ID,
		cmd.Name,
		cmd.SNIsJSON,
		cmd.CertPEM,
		cmd.KeyPEM,
		cmd.MTLSEnabled,
		cmd.ClientCAPEM,
		cmd.VerifyDepth,
		cmd.Enabled,
		cmd.Description,
	)
	return err
}

func (r *SQLiteCertificateRepository) UpdateCertificate(ctx context.Context, cmd entity.UpdateCertificateCommand) error {
	const query = `
	UPDATE ssl_certificates SET
		name = ?,
		snis_json = ?,
		cert_pem = ?,
		key_pem = ?,
		mtls_enabled = ?,
		client_ca_pem = ?,
		verify_depth = ?,
		enabled = ?,
		description = ?,
		updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
	WHERE id = ?
	`

	res, err := r.db.ExecContext(ctx, query,
		cmd.Name,
		cmd.SNIsJSON,
		cmd.CertPEM,
		cmd.KeyPEM,
		cmd.MTLSEnabled,
		cmd.ClientCAPEM,
		cmd.VerifyDepth,
		cmd.Enabled,
		cmd.Description,
		cmd.ID,
	)
	if err != nil {
		return fmt.Errorf("update certificate %q: %w", cmd.ID, err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("certificate %q not found", cmd.ID)
	}
	return nil
}

func (r *SQLiteCertificateRepository) DeleteCertificate(ctx context.Context, id string) error {
	const query = `DELETE FROM ssl_certificates WHERE id = ?`
	res, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete certificate %q: %w", id, err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("certificate %q not found", id)
	}
	return nil
}

func (r *SQLiteCertificateRepository) ToggleCertificateStatus(ctx context.Context, id string, enabled bool) error {
	const query = `UPDATE ssl_certificates SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
	val := 0
	if enabled {
		val = 1
	}
	res, err := r.db.ExecContext(ctx, query, val, id)
	if err != nil {
		return fmt.Errorf("toggle certificate status: %w", err)
	}
	rowsAffected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("certificate %q not found", id)
	}
	return nil
}

func (r *SQLiteCertificateRepository) GetAllActiveCertificates(ctx context.Context) ([]entity.CertificateItem, error) {
	const query = `
	SELECT 
		id, name, snis_json, cert_pem, key_pem, mtls_enabled,
		client_ca_pem, verify_depth, enabled, description,
		created_at, updated_at
	FROM ssl_certificates
	WHERE enabled = 1
	ORDER BY created_at DESC
	`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("get all active certificates: %w", err)
	}
	defer rows.Close()

	items := make([]entity.CertificateItem, 0)
	for rows.Next() {
		var item entity.CertificateItem
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.SNIsJSON,
			&item.CertPEM,
			&item.KeyPEM,
			&item.MTLSEnabled,
			&item.ClientCAPEM,
			&item.VerifyDepth,
			&item.Enabled,
			&item.Description,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan active certificate: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
