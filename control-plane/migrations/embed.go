package migrations

import _ "embed"

// Bootstrap only establishes migration bookkeeping; policy tables come later.
//
//go:embed 0001_bootstrap.sql
var Bootstrap string

//go:embed 0002_rules.sql
var Rules string

//go:embed 0003_activation_journal.sql
var ActivationJournal string

//go:embed 0004_rule_definitions.sql
var RuleDefinitions string

//go:embed 0005_users.sql
var Users string

//go:embed 0006_cluster_nodes.sql
var ClusterNodes string

//go:embed 0007_system_settings.sql
var SystemSettings string

//go:embed 0008_node_metrics_history.sql
var NodeMetricsHistory string

//go:embed 0009_cluster_node_commands.sql
var ClusterNodeCommands string

