-- Migration 0008: Rate limit metrics aggregation tables

CREATE TABLE IF NOT EXISTS rate_limit_hourly_metrics (
    hour_bucket TEXT PRIMARY KEY,
    total_hits INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0,
    throttled_count INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms REAL NOT NULL DEFAULT 0.0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_endpoint_metrics (
    hour_bucket TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    rule_name TEXT NOT NULL DEFAULT '',
    request_count INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0,
    throttled_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY(hour_bucket, endpoint, method)
);

CREATE INDEX IF NOT EXISTS idx_rl_hourly_bucket ON rate_limit_hourly_metrics(hour_bucket);
CREATE INDEX IF NOT EXISTS idx_rl_endpoints_bucket ON rate_limit_endpoint_metrics(hour_bucket);
CREATE INDEX IF NOT EXISTS idx_rl_endpoints_blocked ON rate_limit_endpoint_metrics(blocked_count DESC);
