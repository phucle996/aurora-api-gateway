package migrations

import _ "embed"

// Tables establishes all table definitions and the schema_migrations ledger.
//
//go:embed 0001_tables.sql
var Tables string

// Indexes establishes all index definitions for query performance and constraints.
//
//go:embed 0002_indexes.sql
var Indexes string

// Triggers establishes all immutability triggers for audit and revision integrity.
//
//go:embed 0003_triggers.sql
var Triggers string

// Seeds establishes initial seed records (sequence offsets, default admin user, local cluster node, system settings).
//
//go:embed 0004_seeds.sql
var Seeds string

// Domains establishes domains table and initial seed data.
//
//go:embed 0005_domains.sql
var Domains string

// Upstreams establishes upstreams table and release ledger.
//
//go:embed 0006_upstreams.sql
var Upstreams string

// RateLimits establishes rate_limit_rules table and indexes.
//
//go:embed 0007_rate_limits.sql
var RateLimits string

// RateLimitMetrics establishes rate_limit_hourly_metrics and rate_limit_endpoint_metrics tables.
//
//go:embed 0008_rate_limit_metrics.sql
var RateLimitMetrics string

// SecuritySettings establishes auth_providers table and 2FA user schema.
//
//go:embed 0009_security_settings.sql
var SecuritySettings string

// NotificationChannels establishes notification_channels and notification_rules tables.
//
//go:embed 0010_notification_channels.sql
var NotificationChannels string

// BackupSettings establishes backup_settings and backup_history tables.
//
//go:embed 0011_backup_settings.sql
var BackupSettings string

//go:embed 0012_origin_observations.sql
var OriginObservations string

//go:embed 0013_node_dependencies.sql
var NodeDependencies string
