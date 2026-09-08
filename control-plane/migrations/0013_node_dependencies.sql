CREATE TABLE node_dependencies (
 node_id TEXT PRIMARY KEY REFERENCES cluster_nodes(id) ON DELETE CASCADE,
 checked_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
 nginx_version TEXT NOT NULL, architecture TEXT NOT NULL,
 modules_json TEXT NOT NULL, installable INTEGER NOT NULL, error TEXT NOT NULL
);
CREATE TABLE dependency_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 node_id TEXT NOT NULL REFERENCES cluster_nodes(id) ON DELETE CASCADE,
 action TEXT NOT NULL CHECK(action IN ('check','install_brotli')),
 state TEXT NOT NULL CHECK(state IN ('pending','running','succeeded','failed')),
 message TEXT NOT NULL DEFAULT '', requested_by TEXT NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX dependency_job_active ON dependency_jobs(node_id) WHERE state IN ('pending','running');
CREATE INDEX dependency_job_latest ON dependency_jobs(node_id,id DESC);
