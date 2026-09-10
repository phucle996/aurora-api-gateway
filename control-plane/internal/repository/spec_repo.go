package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
)

type SpecSyncRepository struct {
	writer *sql.DB
	reader *sql.DB
}

func NewSpecSyncRepository(writer, reader *sql.DB) repo.SpecSyncRepository {
	return &SpecSyncRepository{
		writer: writer,
		reader: reader,
	}
}

func (r *SpecSyncRepository) GetAuthorityData(ctx context.Context, nodeID string) (*entity.SpecAuthorityData, error) {
	out := &entity.SpecAuthorityData{
		NodeID: nodeID,
	}

	// 1. Check node existence and fetch WAF + Access releases using CTE
	const authorityQuery = `
	WITH node_auth AS (
		SELECT id FROM cluster_nodes WHERE id = ?
		UNION ALL
		SELECT 'cluster' WHERE ? = '' OR ? = 'cluster'
		LIMIT 1
	)
	SELECT 
		n.id,
		coalesce(ph.release_id, 0),
		coalesce(pr.payload, ''),
		coalesce(ah.release_id, 0),
		coalesce(ar.payload, '')
	FROM node_auth n
	LEFT JOIN policy_cluster_head ph ON ph.singleton = 1
	LEFT JOIN policy_cluster_releases pr ON pr.id = ph.release_id
	LEFT JOIN access_head ah ON ah.singleton = 1
	LEFT JOIN access_releases ar ON ar.id = ah.release_id
	`

	var id string
	var wafPayload, accessPayload []byte
	err := r.reader.QueryRowContext(ctx, authorityQuery, nodeID, nodeID, nodeID).Scan(
		&id,
		&out.WAFReleaseID,
		&wafPayload,
		&out.AccessReleaseID,
		&accessPayload,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("unregistered node: %s", nodeID)
		}
		return nil, fmt.Errorf("query spec authority: %w", err)
	}
	out.WAFPayload = wafPayload
	out.AccessPayload = accessPayload

	// 2. Fetch latest Upstream release config
	const upstreamsQuery = `
	SELECT coalesce(config_content, '')
	FROM upstream_releases
	ORDER BY release_id DESC
	LIMIT 1
	`
	var upstreamConf string
	err = r.reader.QueryRowContext(ctx, upstreamsQuery).Scan(&upstreamConf)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("query upstream release: %w", err)
		}
		upstreamConf = "# No upstreams configured\n"
	}
	out.UpstreamsConf = upstreamConf

	// 3. Fetch Domain routing records
	const routingQuery = `
	SELECT 
		coalesce(d.id, 0),
		coalesce(d.domain, ''),
		coalesce(d.status, ''),
		coalesce(d.upstream, ''),
		coalesce(u.algorithm, d.upstream_algorithm),
		coalesce(u.servers_json, ''),
		coalesce(u.transport_json, ''),
		coalesce(u.internal_ssl_json, ''),
		coalesce(u.probes_json, '[]'),
		coalesce(u.dynamic_dns, 0)
	FROM domains d
	LEFT JOIN upstreams u ON u.name = d.upstream
	ORDER BY d.id
	`
	rows, err := r.reader.QueryContext(ctx, routingQuery)
	if err != nil {
		return nil, fmt.Errorf("query routing records: %w", err)
	}
	defer rows.Close()

	var records []entity.SpecRoutingRecord
	for rows.Next() {
		var rec entity.SpecRoutingRecord
		var algorithm sql.NullString
		if err := rows.Scan(
			&rec.ID,
			&rec.Host,
			&rec.Status,
			&rec.Target,
			&algorithm,
			&rec.ServersJSON,
			&rec.TransportJSON,
			&rec.SSLJSON,
			&rec.ProbesJSON,
			&rec.DynamicDNS,
		); err != nil {
			return nil, fmt.Errorf("scan routing record: %w", err)
		}
		rec.Algorithm = algorithm.String
		if rec.ID > 0 {
			records = append(records, rec)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate routing records: %w", err)
	}
	out.RoutingRecords = records

	// 4. Fetch Extensions catalog
	const extensionsQuery = `
	SELECT id, name, category, enabled, config_json
	FROM extensions
	ORDER BY id
	`
	extRows, err := r.reader.QueryContext(ctx, extensionsQuery)
	if err == nil {
		defer extRows.Close()
		var extensions []entity.SpecExtensionRecord
		for extRows.Next() {
			var ext entity.SpecExtensionRecord
			var enabledInt int
			if err := extRows.Scan(&ext.ID, &ext.Name, &ext.Category, &enabledInt, &ext.ConfigJSON); err == nil {
				ext.Enabled = enabledInt == 1
				extensions = append(extensions, ext)
			}
		}
		out.Extensions = extensions
	}

	return out, nil
}

func (r *SpecSyncRepository) RecordReport(ctx context.Context, cmd entity.SpecReportCommand) error {
	syncStatus := "Syncing"
	if cmd.Status == "in_sync" || cmd.Status == "applied" || cmd.Status == "In Sync" {
		syncStatus = "In Sync"
	}

	const updateNodeSQL = `
	UPDATE cluster_nodes
	SET observed_release_id = CASE WHEN ? > 0 THEN ? ELSE observed_release_id END,
		sync_status = ?,
		last_applied_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
		last_heartbeat = strftime('%Y-%m-%dT%H:%M:%fZ','now')
	WHERE id = ?
	`
	_, err := r.writer.ExecContext(ctx, updateNodeSQL, cmd.ReleaseID, cmd.ReleaseID, syncStatus, cmd.NodeID)
	if err != nil {
		return fmt.Errorf("record spec report in cluster_nodes: %w", err)
	}
	return nil
}

func (r *SpecSyncRepository) GetActiveSpecRelease(ctx context.Context) (*entity.ClusterSpecRelease, error) {
	const activeQuery = `
	WITH active_spec AS (
		SELECT release_id FROM cluster_spec_head WHERE singleton = 1
	)
	SELECT r.id, r.digest, r.spec_yaml, r.actor, r.change_summary, r.created_at
	FROM active_spec h
	JOIN cluster_spec_releases r ON r.id = h.release_id;
	`
	var out entity.ClusterSpecRelease
	err := r.reader.QueryRowContext(ctx, activeQuery).Scan(
		&out.ID,
		&out.Digest,
		&out.SpecYAML,
		&out.Actor,
		&out.ChangeSummary,
		&out.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("query active cluster spec release: %w", err)
	}
	return &out, nil
}

func (r *SpecSyncRepository) PublishSpecRelease(ctx context.Context, release entity.ClusterSpecRelease) (*entity.ClusterSpecRelease, error) {
	tx, err := r.writer.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin publish spec tx: %w", err)
	}
	defer tx.Rollback()

	actor := release.Actor
	if actor == "" {
		actor = "system"
	}

	const insertReleaseSQL = `
	INSERT INTO cluster_spec_releases (digest, spec_yaml, actor, change_summary)
	VALUES (?, ?, ?, ?);
	`
	res, err := tx.ExecContext(ctx, insertReleaseSQL, release.Digest, release.SpecYAML, actor, release.ChangeSummary)
	if err != nil {
		return nil, fmt.Errorf("insert cluster spec release: %w", err)
	}

	id, err := res.LastInsertId()
	if err != nil {
		return nil, fmt.Errorf("get last insert id for cluster spec release: %w", err)
	}

	const upsertHeadSQL = `
	INSERT INTO cluster_spec_head (singleton, release_id)
	VALUES (1, ?)
	ON CONFLICT(singleton) DO UPDATE SET release_id = excluded.release_id;
	`
	if _, err := tx.ExecContext(ctx, upsertHeadSQL, id); err != nil {
		return nil, fmt.Errorf("update cluster spec head: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit publish spec tx: %w", err)
	}

	out := release
	out.ID = id
	out.Actor = actor
	return &out, nil
}

