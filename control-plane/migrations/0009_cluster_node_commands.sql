-- Bổ sung hỗ trợ chỉ thị lệnh (directives) và quản lý trạng thái rolling reload cho Cluster Nodes
ALTER TABLE cluster_nodes ADD COLUMN pending_command TEXT NOT NULL DEFAULT 'none';
ALTER TABLE cluster_nodes ADD COLUMN reload_status TEXT NOT NULL DEFAULT 'idle' CHECK(reload_status IN ('idle', 'pending', 'reloading', 'completed'));

CREATE INDEX IF NOT EXISTS idx_cluster_nodes_reload ON cluster_nodes(reload_status, pending_command);
