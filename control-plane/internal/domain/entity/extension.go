package entity

// ExtensionRecord represents the flat authority projection of an extension.
type ExtensionRecord struct {
	ID          string
	Name        string
	Category    string
	Description string
	Version     string
	Enabled     bool
	ConfigJSON  string
	SchemaJSON  string
	IsBuiltin   bool
	CreatedAt   string
	UpdatedAt   string
}

// ListExtensionsQuery defines filtering options when listing extensions.
type ListExtensionsQuery struct {
	Category string
	Status   string // "enabled", "disabled", "all"
}

// UpdateExtensionStatusCommand updates the enabled status of an extension.
type UpdateExtensionStatusCommand struct {
	ID      string
	Enabled bool
}

// UpdateExtensionConfigCommand updates the configuration JSON of an extension.
type UpdateExtensionConfigCommand struct {
	ID         string
	ConfigJSON string
}

// UpdateExtensionSchemaCommand updates the schema JSON of an extension.
type UpdateExtensionSchemaCommand struct {
	ID         string
	SchemaJSON string
}
