package dto

// ExtensionResponse represents an extension returned by the HTTP API.
type ExtensionResponse struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Version     string `json:"version"`
	Enabled     bool   `json:"enabled"`
	ConfigJSON  string `json:"config_json"`
	SchemaJSON  string `json:"schema_json"`
	IsBuiltin   bool   `json:"is_builtin"`
	CreatedAt   string `json:"created_at"`
	UpdatedAt   string `json:"updated_at"`
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
