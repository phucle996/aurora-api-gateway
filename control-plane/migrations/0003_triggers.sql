-- Migration 0003: All immutability trigger definitions in the system

-- Rule revision triggers
CREATE TRIGGER IF NOT EXISTS immutable_rule_revision_update BEFORE UPDATE ON rule_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER IF NOT EXISTS immutable_rule_revision_delete BEFORE DELETE ON rule_revisions BEGIN SELECT RAISE(ABORT,'immutable revision'); END;

-- Ruleset release triggers
CREATE TRIGGER IF NOT EXISTS immutable_release_payload BEFORE UPDATE OF payload ON ruleset_releases WHEN length(OLD.payload) > 0 BEGIN SELECT RAISE(ABORT,'immutable payload'); END;
CREATE TRIGGER IF NOT EXISTS immutable_ready_release BEFORE UPDATE ON ruleset_releases WHEN OLD.state='ready' BEGIN SELECT RAISE(ABORT,'immutable ready release'); END;
CREATE TRIGGER IF NOT EXISTS immutable_release_delete BEFORE DELETE ON ruleset_releases BEGIN SELECT RAISE(ABORT,'immutable release'); END;

-- Release rules triggers
CREATE TRIGGER IF NOT EXISTS immutable_release_rules_update BEFORE UPDATE ON release_rules BEGIN SELECT RAISE(ABORT,'immutable release membership'); END;
CREATE TRIGGER IF NOT EXISTS immutable_release_rules_delete BEFORE DELETE ON release_rules BEGIN SELECT RAISE(ABORT,'immutable release membership'); END;
CREATE TRIGGER IF NOT EXISTS immutable_release_rules_insert BEFORE INSERT ON release_rules WHEN (SELECT length(payload) FROM ruleset_releases WHERE id=NEW.release_id)>0 BEGIN SELECT RAISE(ABORT,'immutable release membership'); END;

-- Rule definition triggers
CREATE TRIGGER IF NOT EXISTS immutable_definition_update BEFORE UPDATE ON rule_definitions BEGIN SELECT RAISE(ABORT,'immutable definition'); END;
CREATE TRIGGER IF NOT EXISTS immutable_definition_delete BEFORE DELETE ON rule_definitions BEGIN SELECT RAISE(ABORT,'immutable definition'); END;

-- Policy revision & release triggers
CREATE TRIGGER IF NOT EXISTS immutable_policy_revision_update BEFORE UPDATE ON policy_revisions BEGIN SELECT RAISE(ABORT,'immutable policy revision'); END;
CREATE TRIGGER IF NOT EXISTS immutable_policy_revision_delete BEFORE DELETE ON policy_revisions BEGIN SELECT RAISE(ABORT,'immutable policy revision'); END;
CREATE TRIGGER IF NOT EXISTS immutable_policy_release_update BEFORE UPDATE ON policy_cluster_releases BEGIN SELECT RAISE(ABORT,'immutable policy release'); END;
CREATE TRIGGER IF NOT EXISTS immutable_policy_release_delete BEFORE DELETE ON policy_cluster_releases BEGIN SELECT RAISE(ABORT,'immutable policy release'); END;

-- Access release & revision triggers
CREATE TRIGGER IF NOT EXISTS access_release_immutable BEFORE UPDATE ON access_releases BEGIN SELECT RAISE(ABORT,'immutable access release'); END;
CREATE TRIGGER IF NOT EXISTS access_revision_immutable BEFORE UPDATE ON access_revisions BEGIN SELECT RAISE(ABORT,'immutable access revision'); END;
