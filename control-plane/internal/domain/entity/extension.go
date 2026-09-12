package entity

// ExtensionRecord is the extension-instance projection. Runtime metadata comes
// from its immutable manifest, while this record owns only durable instance state.
type ExtensionRecord struct {
	ID               string
	ManifestKey      string
	ManifestVersion  uint32
	ManifestDigest   string
	Name             string
	Category         string
	Description      string
	Enabled          bool
	ConfigJSON       string
	ConfigSchemaJSON string
	UISchemaJSON     string
	Supported        bool
	IsBuiltin        bool
	CreatedAt        string
	UpdatedAt        string
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
