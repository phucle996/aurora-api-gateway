CREATE TABLE rules (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 version INTEGER NOT NULL CHECK(version > 0),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 description TEXT NOT NULL,
 rule_group TEXT NOT NULL CHECK(rule_group IN ('custom','sqli','xss','traversal','bot','endpoint','authentication')),
 action TEXT NOT NULL CHECK(action IN ('allow','log','block')),
 severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
 score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 1000),
 priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 1000000),
 path TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE rule_revisions (
 rule_id INTEGER NOT NULL REFERENCES rules(id), version INTEGER NOT NULL,
 name TEXT NOT NULL, description TEXT NOT NULL, rule_group TEXT NOT NULL,
 action TEXT NOT NULL, severity TEXT NOT NULL, score INTEGER NOT NULL,
 priority INTEGER NOT NULL, path TEXT NOT NULL, enabled INTEGER NOT NULL,
 updated_at TEXT NOT NULL, actor TEXT NOT NULL,
 PRIMARY KEY(rule_id, version)
);
CREATE TABLE rule_creates (
 request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
 rule_id INTEGER NOT NULL REFERENCES rules(id)
);
CREATE TABLE ruleset_releases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_key TEXT NOT NULL UNIQUE,
 payload BLOB NOT NULL DEFAULT X'',
 digest TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL CHECK(state IN ('pending','ready','rejected')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE release_rules (
 release_id INTEGER NOT NULL REFERENCES ruleset_releases(id),
 rule_id INTEGER NOT NULL, version INTEGER NOT NULL,
 PRIMARY KEY(release_id, rule_id),
 FOREIGN KEY(rule_id, version) REFERENCES rule_revisions(rule_id, version)
);
-- Local single-node activation journal; reload_requested is NOT applied.
CREATE TABLE node_activation (
 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
 release_id INTEGER NOT NULL REFERENCES ruleset_releases(id),
 phase TEXT NOT NULL CHECK(phase IN ('pending','reload_requested')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX rules_filter ON rules(rule_group, enabled, id);
CREATE TRIGGER immutable_rule_revision_update BEFORE UPDATE ON rule_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER immutable_rule_revision_delete BEFORE DELETE ON rule_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER immutable_release_payload BEFORE UPDATE OF payload ON ruleset_releases WHEN length(OLD.payload) > 0 BEGIN SELECT RAISE(ABORT,'immutable payload'); END;
CREATE TRIGGER immutable_release_rules_update BEFORE UPDATE ON release_rules BEGIN SELECT RAISE(ABORT,'immutable release membership'); END;
CREATE TRIGGER immutable_release_rules_delete BEFORE DELETE ON release_rules BEGIN SELECT RAISE(ABORT,'immutable release membership'); END;
