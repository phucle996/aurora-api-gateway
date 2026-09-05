// Package activation owns the local single-node, operator-authorized deployment
// workflow. HTTP rule mutation never executes a shell or controls these paths.
package activation

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

type Command struct{ ReleaseID int64 }
type Result struct {
	ReleaseID int64
	Phase     string
}
type Source struct {
	Payload, Previous []byte
	Digest, Phase     string
}
type Repository interface {
	Prepare(context.Context, Command, []byte) (Source, error)
	SetPhase(context.Context, Command, string) error
}
type Node interface {
	Check(context.Context) error
	Reload(context.Context) error
}
type Service struct {
	Repository Repository
	Node       Node
	PolicyPath string
}

func (s *Service) Activate(ctx context.Context, c Command) (Result, error) {
	out := Result{ReleaseID: c.ReleaseID}
	if c.ReleaseID < 1 || !filepath.IsAbs(s.PolicyPath) {
		return out, fmt.Errorf("invalid activation command")
	}
	// The directory is operator-owned. Flock serializes CLI processes and crash
	// recovery; it is never acquired by an NGINX request or Go rule mutation.
	lock, err := os.OpenFile(s.PolicyPath+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return out, err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return out, fmt.Errorf("activation already running: %w", err)
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	file, err := os.Open(s.PolicyPath)
	if err != nil {
		return out, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return out, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > 65536 {
		file.Close()
		return out, fmt.Errorf("invalid current snapshot")
	}
	previous, err := io.ReadAll(io.LimitReader(file, 65537))
	file.Close()
	if err != nil {
		return out, err
	}
	source, err := s.Repository.Prepare(ctx, c, previous)
	if err != nil {
		return out, err
	}
	sum := sha256.Sum256(source.Payload)
	if len(source.Payload) < 1 || len(source.Payload) > 65536 || hex.EncodeToString(sum[:]) != source.Digest {
		return out, fmt.Errorf("release digest mismatch")
	}
	// A completed request is idempotent only if the durable disk pointer agrees.
	oldSum := sha256.Sum256(previous)
	if source.Phase == "reload_requested" && oldSum == sum {
		out.Phase = source.Phase
		return out, nil
	}
	if err = s.Repository.SetPhase(ctx, c, "pending"); err != nil {
		return out, err
	}
	if err = replaceSnapshot(s.PolicyPath, source.Payload); err != nil {
		return out, err
	}
	if err = s.Node.Check(ctx); err != nil {
		// Invalid candidate must not break cold restart. Restore the durable previous
		// bytes; workers still retain their immutable last-known-good generation.
		restoreErr := replaceSnapshot(s.PolicyPath, source.Previous)
		if restoreErr != nil {
			return out, errors.Join(err, restoreErr)
		}
		// A cancelled request must leave pending, so the next invocation reconciles.
		phaseErr := s.Repository.SetPhase(ctx, c, "rejected")
		return out, errors.Join(err, phaseErr)
	}
	if err = s.Node.Reload(ctx); err != nil {
		return out, err
	} // pending: retry may safely resend HUP
	if err = s.Repository.SetPhase(ctx, c, "reload_requested"); err != nil {
		return out, err
	}
	out.Phase = "reload_requested"
	return out, nil
}

// Workflow-private primitive: install AND rollback must obey the identical
// write/fsync/rename/directory-fsync contract; duplicating it risks unsafe recovery.
func replaceSnapshot(path string, payload []byte) error {
	dir := filepath.Dir(path)
	f, err := os.CreateTemp(dir, ".aurora-snapshot-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(payload); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

type SQLiteRepository struct{ DB *sql.DB }

func (r *SQLiteRepository) Prepare(ctx context.Context, c Command, previous []byte) (Source, error) {
	var source Source
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return source, err
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, "SELECT payload,digest FROM ruleset_releases WHERE id=? AND state='ready'", c.ReleaseID).Scan(&source.Payload, &source.Digest)
	if err != nil {
		return source, fmt.Errorf("release not ready: %w", err)
	}
	var header struct {
		SchemaVersion int   `json:"schema_version"`
		Generation    int64 `json:"generation"`
	}
	sum := sha256.Sum256(source.Payload)
	if len(source.Payload) < 1 || len(source.Payload) > 65536 || hex.EncodeToString(sum[:]) != source.Digest || json.Unmarshal(source.Payload, &header) != nil || header.SchemaVersion != 2 || header.Generation != c.ReleaseID {
		return source, fmt.Errorf("release integrity or generation mismatch")
	}
	var priorID int64
	err = tx.QueryRowContext(ctx, "SELECT release_id,phase,previous_payload FROM node_activation WHERE singleton=1").Scan(&priorID, &source.Phase, &source.Previous)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return source, err
	}
	if priorID > c.ReleaseID {
		return source, fmt.Errorf("stale release; rollback requires a new published generation")
	}
	if priorID == c.ReleaseID {
		return source, nil
	}
	if source.Phase == "pending" {
		return source, fmt.Errorf("recover pending release %d before activating another", priorID)
	}
	source.Previous = previous
	source.Phase = "pending"
	_, err = tx.ExecContext(ctx, `INSERT INTO node_activation(singleton,release_id,phase,previous_payload) VALUES(1,?,'pending',?)
 ON CONFLICT(singleton) DO UPDATE SET release_id=excluded.release_id,phase='pending',previous_payload=excluded.previous_payload,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, c.ReleaseID, previous)
	if err != nil {
		return source, err
	}
	return source, tx.Commit()
}
func (r *SQLiteRepository) SetPhase(ctx context.Context, c Command, phase string) error {
	result, err := r.DB.ExecContext(ctx, "UPDATE node_activation SET phase=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE singleton=1 AND release_id=?", phase, c.ReleaseID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err == nil && n != 1 {
		return fmt.Errorf("activation journal changed")
	}
	return err
}
