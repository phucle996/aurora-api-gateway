package repository

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"context"
	"database/sql"
	"errors"
)

type authRepository struct {
	db *sql.DB
}

func NewAuthRepository(db *sql.DB) repo.AuthRepository {
	return &authRepository{db: db}
}

func (r *authRepository) FindByUsername(ctx context.Context, username string) (*entity.User, error) {
	const query = `
		WITH target_user AS (
			SELECT id, username, password_hash, salt, role, created_at, updated_at
			FROM users
			WHERE LOWER(username) = LOWER(?)
			LIMIT 1
		)
		SELECT id, username, password_hash, salt, role, created_at, updated_at
		FROM target_user;
	`
	var u entity.User
	err := r.db.QueryRowContext(ctx, query, username).Scan(
		&u.ID,
		&u.Username,
		&u.PasswordHash,
		&u.Salt,
		&u.Role,
		&u.CreatedAt,
		&u.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, taxonomy.ErrUserNotFound
		}
		return nil, err
	}
	return &u, nil
}
