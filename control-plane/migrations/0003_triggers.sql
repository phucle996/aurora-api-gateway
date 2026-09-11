-- Migration 0003: All immutability trigger definitions in the system

-- Cluster spec snapshot release triggers

CREATE TRIGGER IF NOT EXISTS immutable_cluster_spec_release_update BEFORE UPDATE ON cluster_spec_releases BEGIN SELECT RAISE(ABORT,'immutable cluster spec release'); END;
CREATE TRIGGER IF NOT EXISTS immutable_cluster_spec_release_delete BEFORE DELETE ON cluster_spec_releases BEGIN SELECT RAISE(ABORT,'immutable cluster spec release'); END;
