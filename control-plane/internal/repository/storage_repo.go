package repository

import (
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"database/sql"
)

type storageRepository struct{ db *sql.DB }

func NewStorageRepository(db *sql.DB) repo.StorageRepository {
	return &storageRepository{db: db}
}

func (r *storageRepository) Check(ctx context.Context) error {
	var version int
	return r.db.QueryRowContext(ctx, "SELECT version FROM schema_migrations WHERE version = 1").Scan(&version)
}
