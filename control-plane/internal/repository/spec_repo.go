package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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

	// 1. Check node existence using CTE
	const authorityQuery = `
	WITH node_auth AS (
		SELECT id FROM cluster_nodes WHERE id = ?
		UNION ALL
		SELECT 'cluster' WHERE ? = '' OR ? = 'cluster'
		LIMIT 1
	)
	SELECT n.id
	FROM node_auth n;
	`

	var id string
	err := r.reader.QueryRowContext(ctx, authorityQuery, nodeID, nodeID, nodeID).Scan(&id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("unregistered node: %s", nodeID)
		}
		return nil, fmt.Errorf("query spec authority: %w", err)
	}


	// 2. Fetch Upstream definitions directly from upstreams table and render configuration
	const upstreamsQuery = `
	SELECT name, architecture_type, algorithm, servers_json, transport_json
	FROM upstreams
	ORDER BY name ASC
	`
	uRows, err := r.reader.QueryContext(ctx, upstreamsQuery)
	if err != nil {
		return nil, fmt.Errorf("query upstreams: %w", err)
	}
	defer uRows.Close()

	var sb strings.Builder
	sb.WriteString("# Auto-generated Aurora API Gateway Upstreams Configuration\n")
	sb.WriteString("# Do not edit manually - managed by Aurora Control-Plane\n\n")

	hasUpstreams := false
	for uRows.Next() {
		hasUpstreams = true
		var name, archType, algo, srvJSON, transJSON string
		if err := uRows.Scan(&name, &archType, &algo, &srvJSON, &transJSON); err != nil {
			return nil, fmt.Errorf("scan upstream: %w", err)
		}

		sb.WriteString(fmt.Sprintf("upstream %s {\n", name))
		if archType == "Load Balancer" && algo != "" && algo != "round_robin" {
			sb.WriteString(fmt.Sprintf("    %s;\n", algo))
		}

		var servers []struct {
			Address     string `json:"address"`
			Weight      int    `json:"weight"`
			MaxFails    int    `json:"maxFails"`
			FailTimeout string `json:"failTimeout"`
			Backup      bool   `json:"backup"`
		}
		_ = json.Unmarshal([]byte(srvJSON), &servers)
		for _, srv := range servers {
			var flags []string
			if srv.Weight > 0 && archType == "Load Balancer" {
				flags = append(flags, fmt.Sprintf("weight=%d", srv.Weight))
			}
			if srv.MaxFails > 0 {
				flags = append(flags, fmt.Sprintf("max_fails=%d", srv.MaxFails))
			}
			if srv.FailTimeout != "" {
				flags = append(flags, fmt.Sprintf("fail_timeout=%s", srv.FailTimeout))
			}
			if srv.Backup {
				flags = append(flags, "backup")
			}
			flagStr := ""
			if len(flags) > 0 {
				flagStr = " " + strings.Join(flags, " ")
			}
			sb.WriteString(fmt.Sprintf("    server %s%s;\n", srv.Address, flagStr))
		}

		var transport struct {
			KeepAliveConnections int `json:"keepAliveConnections"`
		}
		_ = json.Unmarshal([]byte(transJSON), &transport)
		keepalive := transport.KeepAliveConnections
		if keepalive <= 0 {
			keepalive = 32
		}
		sb.WriteString(fmt.Sprintf("    keepalive %d;\n", keepalive))
		sb.WriteString("}\n\n")
	}
	if err := uRows.Err(); err != nil {
		return nil, fmt.Errorf("iterate upstreams: %w", err)
	}

	if !hasUpstreams {
		out.UpstreamsConf = "# No upstreams configured\n"
	} else {
		out.UpstreamsConf = sb.String()
	}

	// 3. Fetch Routing records from routes table
	const routingQuery = `
	SELECT 
		coalesce(r.rowid, 0),
		coalesce(r.host, ''),
		coalesce(r.path, '/'),
		case when r.enabled = 1 then 'Active' else 'Inactive' end,
		coalesce(r.upstream_name, ''),
		coalesce(u.algorithm, 'round_robin'),
		coalesce(u.servers_json, ''),
		coalesce(u.transport_json, ''),
		coalesce(u.internal_ssl_json, ''),
		coalesce(u.probes_json, '[]'),
		coalesce(u.dynamic_dns, 0),
		coalesce(r.strip_path, 0),
		coalesce(r.websocket, 0),
		coalesce(r.priority, 0),
		coalesce(r.plugins_json, '{}')
	FROM routes r
	LEFT JOIN upstreams u ON u.name = r.upstream_name
	WHERE r.enabled = 1
	ORDER BY r.priority DESC, r.created_at
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
			&rec.Path,
			&rec.Status,
			&rec.Target,
			&algorithm,
			&rec.ServersJSON,
			&rec.TransportJSON,
			&rec.SSLJSON,
			&rec.ProbesJSON,
			&rec.DynamicDNS,
			&rec.StripPath,
			&rec.WebSocket,
			&rec.Priority,
			&rec.PluginsJSON,
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

	// 4. Fetch Active SSL Certificates
	const certificatesQuery = `
	SELECT id, name, snis_json, cert_pem, key_pem, mtls_enabled, coalesce(client_ca_pem, ''), verify_depth
	FROM ssl_certificates
	WHERE enabled = 1
	ORDER BY created_at DESC
	`
	certRows, err := r.reader.QueryContext(ctx, certificatesQuery)
	if err == nil {
		defer certRows.Close()
		var certs []entity.SpecCertificateRecord
		for certRows.Next() {
			var cert entity.SpecCertificateRecord
			if err := certRows.Scan(
				&cert.ID,
				&cert.Name,
				&cert.SNIsJSON,
				&cert.CertPEM,
				&cert.KeyPEM,
				&cert.MTLSEnabled,
				&cert.ClientCAPEM,
				&cert.VerifyDepth,
			); err == nil {
				certs = append(certs, cert)
			}
		}
		if err := certRows.Err(); err != nil {
			return nil, fmt.Errorf("iterate certificates: %w", err)
		}
		out.Certificates = certs
	}

	// 5. Fetch Extensions catalog
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
		if err := extRows.Err(); err != nil {
			return nil, fmt.Errorf("iterate extensions: %w", err)
		}
		out.Extensions = extensions
	}

	// 6. Fetch Unified Upstreams & Active L4 Services
	const unifiedUpstreamsQuery = `
	SELECT id, name, algorithm, servers_json
	FROM upstreams
	ORDER BY name ASC
	`
	uRows, err = r.reader.QueryContext(ctx, unifiedUpstreamsQuery)
	if err == nil {
		defer uRows.Close()
		var upstreams []entity.SpecUnifiedUpstreamRecord
		for uRows.Next() {
			var u entity.SpecUnifiedUpstreamRecord
			if err := uRows.Scan(&u.ID, &u.Name, &u.Algorithm, &u.ServersJSON); err == nil {
				upstreams = append(upstreams, u)
			}
		}
		if err := uRows.Err(); err != nil {
			return nil, fmt.Errorf("iterate unified upstreams: %w", err)
		}
		out.UpstreamRecords = upstreams
	}

	const l4ServicesQuery = `
	SELECT id, name, protocol, listen_port, forward_target_type, upstream_name, direct_endpoint,
	       acl_rules_json, proxy_timeout, proxy_connect_timeout, enabled
	FROM l4_services
	WHERE enabled = 1
	ORDER BY listen_port ASC
	`
	l4sRows, err := r.reader.QueryContext(ctx, l4ServicesQuery)
	if err == nil {
		defer l4sRows.Close()
		var l4services []entity.SpecL4ServiceRecord
		for l4sRows.Next() {
			var s entity.SpecL4ServiceRecord
			var enabledInt int
			if err := l4sRows.Scan(
				&s.ID, &s.Name, &s.Protocol, &s.ListenPort, &s.ForwardTargetType, &s.UpstreamName, &s.DirectEndpoint,
				&s.ACLRulesJSON, &s.ProxyTimeout, &s.ProxyConnectTimeout, &enabledInt,
			); err == nil {
				s.Enabled = enabledInt == 1
				l4services = append(l4services, s)
			}
		}
		if err := l4sRows.Err(); err != nil {
			return nil, fmt.Errorf("iterate l4 services: %w", err)
		}
		out.L4Services = l4services
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

	const upsertHeadSQL = `
	INSERT INTO cluster_spec_head (singleton, release_id)
	VALUES (1, ?)
	ON CONFLICT(singleton) DO UPDATE SET release_id = excluded.release_id;
	`

	var id int64
	var existingActor string
	err = tx.QueryRowContext(ctx, "SELECT id, actor FROM cluster_spec_releases WHERE digest = ?", release.Digest).Scan(&id, &existingActor)
	if err == nil {
		actor = existingActor
	} else {
		const insertReleaseSQL = `
		INSERT INTO cluster_spec_releases (digest, spec_yaml, actor, change_summary)
		VALUES (?, ?, ?, ?);
		`
		res, err := tx.ExecContext(ctx, insertReleaseSQL, release.Digest, release.SpecYAML, actor, release.ChangeSummary)
		if err != nil {
			return nil, fmt.Errorf("insert cluster spec release: %w", err)
		}

		id, err = res.LastInsertId()
		if err != nil {
			return nil, fmt.Errorf("get last insert id for cluster spec release: %w", err)
		}
	}

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
