-- Migration 0002: All index definitions in the system
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_cluster_nodes_status ON cluster_nodes(status, sync_status);
CREATE INDEX IF NOT EXISTS idx_metrics_history_time ON node_metrics_history (timestamp);
CREATE INDEX IF NOT EXISTS idx_cluster_nodes_reload ON cluster_nodes(reload_status, pending_command);
CREATE INDEX IF NOT EXISTS idx_node_sync_logs_node_id ON node_sync_logs(node_id, id DESC);

-- Routes indexes

CREATE INDEX IF NOT EXISTS idx_routes_host ON routes(host);
CREATE INDEX IF NOT EXISTS idx_routes_upstream ON routes(upstream_name);
CREATE INDEX IF NOT EXISTS idx_routes_enabled ON routes(enabled);

-- SSL Certificates indexes
CREATE INDEX IF NOT EXISTS idx_ssl_certs_enabled ON ssl_certificates(enabled);

-- Upstreams indexes
CREATE INDEX IF NOT EXISTS idx_upstreams_name ON upstreams(name);
CREATE INDEX IF NOT EXISTS idx_upstreams_type ON upstreams(architecture_type);
CREATE INDEX IF NOT EXISTS idx_upstreams_version ON upstreams(version);

-- Extensions indexes
CREATE INDEX IF NOT EXISTS idx_extensions_category ON extensions(category);
CREATE INDEX IF NOT EXISTS idx_extensions_enabled ON extensions(enabled);

-- Cluster spec releases indexes
CREATE INDEX IF NOT EXISTS idx_cluster_spec_releases_digest ON cluster_spec_releases(digest);

-- L4 Gateway indexes
CREATE INDEX IF NOT EXISTS idx_l4_services_port_proto ON l4_services(protocol, listen_port);
CREATE INDEX IF NOT EXISTS idx_l4_services_upstream ON l4_services(upstream_name);

