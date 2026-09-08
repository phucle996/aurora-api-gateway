-- Historical migration retained for databases already upgraded to v12.
-- The retired origin gateway no longer writes or reads this table.
CREATE TABLE origin_observations (
 node_id TEXT PRIMARY KEY REFERENCES cluster_nodes(id) ON DELETE CASCADE,
 observed_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
 routing_digest TEXT NOT NULL, peers_json TEXT NOT NULL
);
