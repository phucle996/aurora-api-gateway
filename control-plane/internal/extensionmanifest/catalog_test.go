package extensionmanifest

import "testing"

func TestCatalogDefaultsMatchTheirRuntimeSchemas(t *testing.T) {
	manifests, err := All()
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	if len(manifests) != 18 {
		t.Fatalf("expected 18 packaged manifests, got %d", len(manifests))
	}
	digest, err := Digest()
	if err != nil || len(digest) != 64 {
		t.Fatalf("invalid catalog digest %q: %v", digest, err)
	}
	for _, manifest := range manifests {
		if _, err := ValidateConfig(manifest, string(manifest.DefaultConfig)); err != nil {
			t.Fatalf("validate default for %s: %v", manifest.Key, err)
		}
	}
}

func TestJWTManifestRequiresAtLeastOneRuleBeforeEnable(t *testing.T) {
	manifest, ok := Find("builtin/jwt-authentication", 1)
	if !ok {
		t.Fatal("JWT manifest not installed")
	}
	if err := ValidateForEnable(manifest, `{"rules":[]}`); err == nil {
		t.Fatal("expected empty JWT rules to be rejected before enable")
	}
	if err := ValidateForEnable(manifest, `{"rules":[{"id":"gateway","host":"api.example.test","path_prefix":"/","public_key_pem":"-----BEGIN PUBLIC KEY-----\\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtest\\n-----END PUBLIC KEY-----"}]}`); err != nil {
		t.Fatalf("expected populated JWT rule to be enableable: %v", err)
	}
}

func TestValidateConfigRejectsUnknownAndTrailingValues(t *testing.T) {
	manifest, ok := Find("builtin/maintenance-mode", 1)
	if !ok {
		t.Fatal("maintenance manifest not installed")
	}
	if _, err := ValidateConfig(manifest, `{"status_code":503,"message":"maintenance","unknown":true}`); err == nil {
		t.Fatal("expected unknown field to be rejected")
	}
	if _, err := ValidateConfig(manifest, `{"status_code":503,"message":"maintenance"} {}`); err == nil {
		t.Fatal("expected trailing JSON value to be rejected")
	}
	canonical, err := ValidateConfig(manifest, `{"message":"maintenance","status_code":503}`)
	if err != nil {
		t.Fatalf("expected valid config: %v", err)
	}
	if canonical != `{"message":"maintenance","status_code":503}` {
		t.Fatalf("unexpected canonical config: %s", canonical)
	}
}
