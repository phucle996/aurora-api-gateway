CREATE TABLE policies (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 version INTEGER NOT NULL CHECK(version>0),
 document TEXT NOT NULL CHECK(json_valid(document)),
 published_version INTEGER,
 status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Published','Disabled')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE policy_revisions (
 policy_id INTEGER NOT NULL REFERENCES policies(id),
 version INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)),
 actor TEXT NOT NULL, operation TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(policy_id,version)
);
CREATE TABLE policy_receipts (
 actor TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
 result TEXT NOT NULL CHECK(json_valid(result)), PRIMARY KEY(actor,request_key)
);
CREATE TABLE policy_cluster_releases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 payload BLOB NOT NULL, digest TEXT NOT NULL, membership TEXT NOT NULL CHECK(json_valid(membership)),
 actor TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Separate generation namespace from the legacy rule-release workflow.
INSERT INTO sqlite_sequence(name,seq) VALUES('policy_cluster_releases',1000000000000);
CREATE TABLE policy_cluster_head (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 release_id INTEGER NOT NULL REFERENCES policy_cluster_releases(id)
);
CREATE TABLE policy_node_reports (
 node_id TEXT PRIMARY KEY REFERENCES cluster_nodes(id),
 release_id INTEGER NOT NULL REFERENCES policy_cluster_releases(id),
 phase TEXT NOT NULL CHECK(phase IN ('validated','reload_requested','observed','failed')),
 message TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER immutable_policy_revision_update BEFORE UPDATE ON policy_revisions BEGIN SELECT RAISE(ABORT,'immutable policy revision'); END;
CREATE TRIGGER immutable_policy_revision_delete BEFORE DELETE ON policy_revisions BEGIN SELECT RAISE(ABORT,'immutable policy revision'); END;
CREATE TRIGGER immutable_policy_release_update BEFORE UPDATE ON policy_cluster_releases BEGIN SELECT RAISE(ABORT,'immutable policy release'); END;
CREATE TRIGGER immutable_policy_release_delete BEFORE DELETE ON policy_cluster_releases BEGIN SELECT RAISE(ABORT,'immutable policy release'); END;
