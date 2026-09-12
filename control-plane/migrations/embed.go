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

// Seeds establishes initial seed records (default admin user, local cluster node, system settings, auth providers, notifications, backup settings, extension catalog & schemas).
//
//go:embed 0004_seeds.sql
var Seeds string

// ExtensionIPAccess declares the dataplane contract used by the built-in IP restriction extension.
//
//go:embed 0005_extension_ip_access.sql
var ExtensionIPAccess string

// ExtensionIPAccessRepair upgrades databases that briefly used the removed standalone access-rules workflow.
//
//go:embed 0006_extension_ip_access_repair.sql
var ExtensionIPAccessRepair string

// ExtensionInstances replaces the mutable extension catalog with durable
// instances backed by immutable, packaged manifests.
//
//go:embed 0007_extension_instances.sql
var ExtensionInstances string
