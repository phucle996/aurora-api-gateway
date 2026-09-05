CREATE TABLE rule_definitions (
 rule_id INTEGER NOT NULL, version INTEGER NOT NULL,
 logic_mode TEXT NOT NULL CHECK(logic_mode IN ('all','any')),
 conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json)),
 source_ip TEXT NOT NULL, host_domain TEXT NOT NULL, path_prefix TEXT NOT NULL,
 http_method TEXT NOT NULL, response_code INTEGER,
 custom_response TEXT NOT NULL CHECK(length(custom_response)<=512),
 log_event INTEGER NOT NULL CHECK(log_event IN (0,1)),
 add_to_reputation INTEGER NOT NULL CHECK(add_to_reputation IN (0,1)),
 runtime_ready INTEGER NOT NULL CHECK(runtime_ready IN (0,1)),
 runtime_issues TEXT NOT NULL CHECK(json_valid(runtime_issues)),
 PRIMARY KEY(rule_id,version),
 FOREIGN KEY(rule_id,version) REFERENCES rule_revisions(rule_id,version)
);
CREATE TABLE definition_creates (
 request_key TEXT PRIMARY KEY, request_hash TEXT NOT NULL,
 rule_id INTEGER NOT NULL, version INTEGER NOT NULL,
 FOREIGN KEY(rule_id,version) REFERENCES rule_definitions(rule_id,version)
);
CREATE TRIGGER immutable_definition_update BEFORE UPDATE ON rule_definitions BEGIN SELECT RAISE(ABORT,'immutable definition'); END;
CREATE TRIGGER immutable_definition_delete BEFORE DELETE ON rule_definitions BEGIN SELECT RAISE(ABORT,'immutable definition'); END;
