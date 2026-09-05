-- Application checks the old journal is empty before upgrading: v2 did not
-- retain previous bytes, so an existing activation cannot be safely invented.
ALTER TABLE node_activation RENAME TO node_activation_v2;
CREATE TABLE node_activation (
 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
 release_id INTEGER NOT NULL REFERENCES ruleset_releases(id),
 phase TEXT NOT NULL CHECK(phase IN ('pending','reload_requested','rejected')),
 previous_payload BLOB NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
DROP TABLE node_activation_v2;
CREATE TRIGGER immutable_release_rules_insert BEFORE INSERT ON release_rules WHEN (SELECT length(payload) FROM ruleset_releases WHERE id=NEW.release_id)>0 BEGIN SELECT RAISE(ABORT,'immutable release membership'); END;
CREATE TRIGGER immutable_ready_release BEFORE UPDATE ON ruleset_releases WHEN OLD.state='ready' BEGIN SELECT RAISE(ABORT,'immutable ready release'); END;
CREATE TRIGGER immutable_release_delete BEFORE DELETE ON ruleset_releases BEGIN SELECT RAISE(ABORT,'immutable release'); END;
