-- Migration 0002: All index definitions in the system
CREATE INDEX IF NOT EXISTS rules_filter ON rules(rule_group, enabled, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_cluster_nodes_status ON cluster_nodes(status, sync_status);
CREATE INDEX IF NOT EXISTS idx_metrics_history_time ON node_metrics_history (timestamp);
CREATE INDEX IF NOT EXISTS idx_cluster_nodes_reload ON cluster_nodes(reload_status, pending_command);
CREATE INDEX IF NOT EXISTS idx_node_sync_logs_node_id ON node_sync_logs(node_id, id DESC);
CREATE INDEX IF NOT EXISTS access_events_recent ON access_events(created_at DESC);

-- Domains indexes
CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_domains_tls_type ON domains(tls_type);

-- Upstreams indexes
CREATE INDEX IF NOT EXISTS idx_upstreams_name ON upstreams(name);
CREATE INDEX IF NOT EXISTS idx_upstreams_type ON upstreams(architecture_type);
CREATE INDEX IF NOT EXISTS idx_upstreams_version ON upstreams(version);

-- Rate limits and metrics indexes
CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_name ON rate_limit_rules(name);
CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_status ON rate_limit_rules(status);
CREATE INDEX IF NOT EXISTS idx_rl_hourly_bucket ON rate_limit_hourly_metrics(hour_bucket);
CREATE INDEX IF NOT EXISTS idx_rl_endpoints_bucket ON rate_limit_endpoint_metrics(hour_bucket);
CREATE INDEX IF NOT EXISTS idx_rl_endpoints_blocked ON rate_limit_endpoint_metrics(blocked_count DESC);

-- Extensions indexes
CREATE INDEX IF NOT EXISTS idx_extensions_category ON extensions(category);
CREATE INDEX IF NOT EXISTS idx_extensions_enabled ON extensions(enabled);
