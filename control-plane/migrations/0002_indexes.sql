-- Migration 0002: All index definitions in the system
CREATE INDEX IF NOT EXISTS rules_filter ON rules(rule_group, enabled, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_cluster_nodes_status ON cluster_nodes(status, sync_status);
CREATE INDEX IF NOT EXISTS idx_metrics_history_time ON node_metrics_history (timestamp);
CREATE INDEX IF NOT EXISTS idx_cluster_nodes_reload ON cluster_nodes(reload_status, pending_command);
CREATE INDEX IF NOT EXISTS idx_node_sync_logs_node_id ON node_sync_logs(node_id, id DESC);
CREATE INDEX IF NOT EXISTS access_events_recent ON access_events(created_at DESC);
