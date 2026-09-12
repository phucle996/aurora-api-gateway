package extensionmanifest

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
)

//go:embed manifests/*.json
var manifestsFS embed.FS

// Manifest is the immutable runtime contract shipped with both the controller
// and agent. It is intentionally separate from extension instance data.
type Manifest struct {
	Key               string          `json:"key"`
	Version           uint32          `json:"version"`
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Category          string          `json:"category"`
	Description       string          `json:"description"`
	Renderer          string          `json:"renderer"`
	ConfigSchema      json.RawMessage `json:"config_schema"`
	UISchema          json.RawMessage `json:"ui_schema"`
	DefaultConfig     json.RawMessage `json:"default_config"`
	RequiredForEnable []string        `json:"required_for_enable"`
	Builtin           bool            `json:"builtin"`
}

var catalog struct {
	once      sync.Once
	manifests []Manifest
	byKey     map[string]Manifest
	digest    string
	err       error
}

func load() error {
	catalog.once.Do(func() {
		entries, err := manifestsFS.ReadDir("manifests")
		if err != nil {
			catalog.err = fmt.Errorf("read extension manifests directory: %w", err)
			return
		}

		catalog.manifests = make([]Manifest, 0, len(entries))
		catalog.byKey = make(map[string]Manifest, len(entries))

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			content, err := manifestsFS.ReadFile("manifests/" + entry.Name())
			if err != nil {
				catalog.err = fmt.Errorf("read manifest file %s: %w", entry.Name(), err)
				return
			}
			var manifest Manifest
			if err := json.Unmarshal(content, &manifest); err != nil {
				catalog.err = fmt.Errorf("decode extension manifest %s: %w", entry.Name(), err)
				return
			}

			if manifest.Key == "" || manifest.ID == "" || manifest.Version == 0 || manifest.Renderer == "" || len(manifest.ConfigSchema) == 0 || len(manifest.DefaultConfig) == 0 {
				catalog.err = fmt.Errorf("invalid extension manifest %q in %s", manifest.Key, entry.Name())
				return
			}
			var configSchema struct {
				Properties map[string]json.RawMessage `json:"properties"`
			}
			if err := json.Unmarshal(manifest.ConfigSchema, &configSchema); err != nil {
				catalog.err = fmt.Errorf("decode config schema for %s: %w", manifest.Key, err)
				return
			}
			for _, field := range manifest.RequiredForEnable {
				if strings.TrimSpace(field) == "" || configSchema.Properties[field] == nil {
					catalog.err = fmt.Errorf("extension manifest %q has invalid required_for_enable field %q", manifest.Key, field)
					return
				}
			}
			identity := fmt.Sprintf("%s@%d", manifest.Key, manifest.Version)
			if _, exists := catalog.byKey[identity]; exists {
				catalog.err = fmt.Errorf("duplicate extension manifest %s", identity)
				return
			}
			catalog.byKey[identity] = manifest
			catalog.manifests = append(catalog.manifests, manifest)
		}

		// Sort manifests deterministically by key, then version
		sort.Slice(catalog.manifests, func(i, j int) bool {
			if catalog.manifests[i].Key != catalog.manifests[j].Key {
				return catalog.manifests[i].Key < catalog.manifests[j].Key
			}
			return catalog.manifests[i].Version < catalog.manifests[j].Version
		})

		canonicalJSON, err := json.Marshal(catalog.manifests)
		if err != nil {
			catalog.err = fmt.Errorf("marshal canonical manifests: %w", err)
			return
		}
		sum := sha256.Sum256(canonicalJSON)
		catalog.digest = hex.EncodeToString(sum[:])
	})
	return catalog.err
}

func identity(key string, version uint32) string {
	return fmt.Sprintf("%s@%d", key, version)
}

// All returns copies of every installed extension manifest.
func All() ([]Manifest, error) {
	if err := load(); err != nil {
		return nil, err
	}
	return append([]Manifest(nil), catalog.manifests...), nil
}

// Find resolves an installed extension implementation by immutable key and version.
func Find(key string, version uint32) (Manifest, bool) {
	if load() != nil {
		return Manifest{}, false
	}
	manifest, ok := catalog.byKey[identity(key, version)]
	return manifest, ok
}

// Digest identifies the exact manifest catalog the controller used to compile a NodeSpec.
func Digest() (string, error) {
	if err := load(); err != nil {
		return "", err
	}
	return catalog.digest, nil
}

// ValidateConfig applies the manifest's configuration schema and returns canonical JSON.
func ValidateConfig(manifest Manifest, raw string) (string, error) {
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return "", fmt.Errorf("decode config JSON: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return "", fmt.Errorf("config JSON contains multiple values")
		}
		return "", fmt.Errorf("decode trailing config JSON: %w", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(manifest.ConfigSchema, &schema); err != nil {
		return "", fmt.Errorf("decode config schema: %w", err)
	}
	if err := validateValue(schema, value, "config"); err != nil {
		return "", err
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("canonicalize config JSON: %w", err)
	}
	return string(canonical), nil
}

// ValidateForEnable ensures a disabled extension has the data its runtime
// requires before it can enter a NodeSpec. The required fields are part of the
// immutable manifest rather than an extension-ID branch in the service.
func ValidateForEnable(manifest Manifest, raw string) error {
	canonical, err := ValidateConfig(manifest, raw)
	if err != nil {
		return err
	}
	if len(manifest.RequiredForEnable) == 0 {
		return nil
	}

	var config map[string]any
	if err := json.Unmarshal([]byte(canonical), &config); err != nil {
		return fmt.Errorf("decode canonical config: %w", err)
	}
	for _, field := range manifest.RequiredForEnable {
		value, ok := config[field]
		if !ok || emptyRequiredValue(value) {
			return fmt.Errorf("config.%s is required before enabling", field)
		}
	}
	return nil
}

func emptyRequiredValue(value any) bool {
	switch value := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(value) == ""
	case []any:
		return len(value) == 0
	case map[string]any:
		return len(value) == 0
	default:
		return false
	}
}

// validateValue implements the bounded JSON Schema subset used by extension
// manifests. Keeping it local to the manifest workflow prevents UI schema from
// becoming executable runtime authority.
func validateValue(schema map[string]any, value any, path string) error {
	typ, _ := schema["type"].(string)
	switch typ {
	case "object":
		object, ok := value.(map[string]any)
		if !ok {
			return fmt.Errorf("%s must be an object", path)
		}
		properties, _ := schema["properties"].(map[string]any)
		propertySchemas := make(map[string]map[string]any, len(properties))
		for key, rawProperty := range properties {
			property, ok := rawProperty.(map[string]any)
			if !ok {
				return fmt.Errorf("schema property %s is invalid", key)
			}
			propertySchemas[key] = property
		}
		if required, ok := schema["required"].([]any); ok {
			for _, rawRequired := range required {
				key, ok := rawRequired.(string)
				if !ok {
					return fmt.Errorf("schema required key is invalid")
				}
				if _, exists := object[key]; !exists {
					return fmt.Errorf("%s.%s is required", path, key)
				}
			}
		}
		additional, _ := schema["additionalProperties"].(bool)
		for key, child := range object {
			property, exists := propertySchemas[key]
			if !exists {
				if !additional {
					return fmt.Errorf("%s.%s is not supported", path, key)
				}
				continue
			}
			if err := validateValue(property, child, path+"."+key); err != nil {
				return err
			}
		}
	case "array":
		array, ok := value.([]any)
		if !ok {
			return fmt.Errorf("%s must be an array", path)
		}
		if maximum, ok := schema["maxItems"].(float64); ok && len(array) > int(maximum) {
			return fmt.Errorf("%s exceeds %d entries", path, int(maximum))
		}
		if rawItems, exists := schema["items"]; exists {
			items, ok := rawItems.(map[string]any)
			if !ok {
				return fmt.Errorf("schema items for %s is invalid", path)
			}
			for i, child := range array {
				if err := validateValue(items, child, fmt.Sprintf("%s[%d]", path, i)); err != nil {
					return err
				}
			}
		}
	case "string":
		stringValue, ok := value.(string)
		if !ok {
			return fmt.Errorf("%s must be a string", path)
		}
		if maximum, ok := schema["maxLength"].(float64); ok && len(stringValue) > int(maximum) {
			return fmt.Errorf("%s exceeds %d characters", path, int(maximum))
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			return fmt.Errorf("%s must be a boolean", path)
		}
	case "integer":
		number, ok := value.(json.Number)
		if !ok {
			return fmt.Errorf("%s must be an integer", path)
		}
		integer, err := strconv.ParseInt(number.String(), 10, 64)
		if err != nil {
			return fmt.Errorf("%s must be an integer", path)
		}
		if minimum, ok := schema["minimum"].(float64); ok && integer < int64(minimum) {
			return fmt.Errorf("%s must be at least %d", path, int64(minimum))
		}
		if maximum, ok := schema["maximum"].(float64); ok && integer > int64(maximum) {
			return fmt.Errorf("%s must be at most %d", path, int64(maximum))
		}
	case "number":
		if _, ok := value.(json.Number); !ok {
			return fmt.Errorf("%s must be a number", path)
		}
	case "":
		return fmt.Errorf("schema type is required for %s", path)
	default:
		return fmt.Errorf("schema type %q is unsupported", typ)
	}
	if enums, ok := schema["enum"].([]any); ok {
		for _, candidate := range enums {
			if fmt.Sprint(candidate) == fmt.Sprint(value) {
				return nil
			}
		}
		return fmt.Errorf("%s has an unsupported value", path)
	}
	return nil
}
