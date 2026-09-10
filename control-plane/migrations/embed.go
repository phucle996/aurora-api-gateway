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

// Seeds establishes initial seed records (sequence offsets, default admin user, local cluster node, system settings, auth providers, notifications, backup settings).
//
//go:embed 0004_seeds.sql
var Seeds string

// ExtensionSchemas establishes 1:1 render schemas for all extensions.
//
//go:embed 0005_extension_schemas.sql
var ExtensionSchemas string
