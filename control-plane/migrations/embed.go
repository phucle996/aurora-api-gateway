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
