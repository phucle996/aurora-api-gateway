package dto

// ExtensionResponse represents an extension returned by the HTTP API.
type ExtensionResponse struct {
	ID               string `json:"id"`
	ManifestKey      string `json:"manifest_key"`
	ManifestVersion  uint32 `json:"manifest_version"`
	ManifestDigest   string `json:"manifest_digest"`
	Name             string `json:"name"`
	Category         string `json:"category"`
	Description      string `json:"description"`
	Enabled          bool   `json:"enabled"`
	ConfigJSON       string `json:"config_json"`
	ConfigSchemaJSON string `json:"config_schema_json"`
	UISchemaJSON     string `json:"ui_schema_json"`
	Supported        bool   `json:"supported"`
	IsBuiltin        bool   `json:"is_builtin"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

// UpdateExtensionStatusRequest contains status toggle payload.
type UpdateExtensionStatusRequest struct {
	Enabled bool `json:"enabled"`
}

// UpdateExtensionConfigRequest contains extension configuration updates.
// It supports either a raw JSON string (ConfigJSON) or an arbitrary JSON object (Config).
type UpdateExtensionConfigRequest struct {
	ConfigJSON string `json:"config_json,omitempty"`
	Config     any    `json:"config,omitempty"`
}
