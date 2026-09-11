-- Migration 0003: All immutability trigger definitions in the system

-- Access release & revision triggers
CREATE TRIGGER IF NOT EXISTS access_release_immutable BEFORE UPDATE ON access_releases BEGIN SELECT RAISE(ABORT,'immutable access release'); END;
CREATE TRIGGER IF NOT EXISTS access_revision_immutable BEFORE UPDATE ON access_revisions BEGIN SELECT RAISE(ABORT,'immutable access revision'); END;

-- Cluster spec snapshot release triggers
CREATE TRIGGER IF NOT EXISTS immutable_cluster_spec_release_update BEFORE UPDATE ON cluster_spec_releases BEGIN SELECT RAISE(ABORT,'immutable cluster spec release'); END;
CREATE TRIGGER IF NOT EXISTS immutable_cluster_spec_release_delete BEFORE DELETE ON cluster_spec_releases BEGIN SELECT RAISE(ABORT,'immutable cluster spec release'); END;
