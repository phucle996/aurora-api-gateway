package extensionmanifest

import "testing"

func TestCatalogDefaultsMatchTheirRuntimeSchemas(t *testing.T) {
	manifests, err := All()
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	if len(manifests) != 20 {
		t.Fatalf("expected 20 packaged manifests, got %d", len(manifests))
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

func TestCanaryReleaseManifestValidation(t *testing.T) {
	manifest, ok := Find("builtin/canary-release", 1)
	if !ok {
		t.Fatal("Canary Release manifest not installed")
	}
	valid := `{"rules":[{"id":"canary-v1","priority":10,"origin":"*","path_prefix":"/","baseline_upstream":"backend_baseline","canary_upstream":"backend_canary","match_conditions":[{"target":"header","key":"x-canary","regex":"^true$"}],"weight_percentage":20,"split_by":"client_ip","canary_upstream_headers":[{"name":"x-canary-routed","value":"1"}],"baseline_upstream_headers":[]}]}`
	if _, err := ValidateConfig(manifest, valid); err != nil {
		t.Fatalf("expected valid canary release config: %v", err)
	}
	// Missing required field (canary_upstream) should fail
	invalid := `{"rules":[{"id":"canary-v1","baseline_upstream":"backend_baseline"}]}`
	if _, err := ValidateConfig(manifest, invalid); err == nil {
		t.Fatal("expected config missing canary_upstream to be rejected")
	}
}

func TestTrafficSplitManifestValidation(t *testing.T) {
	manifest, ok := Find("builtin/traffic-split", 1)
	if !ok {
		t.Fatal("Traffic Split manifest not installed")
	}
	// Valid 80/20 split config
	valid := `{"rules":[{"id":"canary-v2","priority":10,"origin":"*","path_prefix":"/","split_by":"client_ip","splits":[{"upstream":"backend_v1","weight":80},{"upstream":"backend_v2","weight":20}]}]}`
	if _, err := ValidateConfig(manifest, valid); err != nil {
		t.Fatalf("expected valid traffic split config: %v", err)
	}
	// Missing splits (< 2 targets) should be rejected by schema
	invalidMinItems := `{"rules":[{"id":"canary-v2","splits":[{"upstream":"backend_v1","weight":100}]}]}`
	if _, err := ValidateConfig(manifest, invalidMinItems); err == nil {
		t.Fatal("expected config with < 2 splits to be rejected by schema")
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
	manifest, ok := Find("builtin/request-termination", 1)
	if !ok {
		t.Fatal("request-termination manifest not installed")
	}
	if _, err := ValidateConfig(manifest, `{"status_code":503,"body":"maintenance","unknown":true}`); err == nil {
		t.Fatal("expected unknown field to be rejected")
	}
	if _, err := ValidateConfig(manifest, `{"status_code":503,"body":"maintenance"} {}`); err == nil {
		t.Fatal("expected trailing JSON value to be rejected")
	}
	canonical, err := ValidateConfig(manifest, `{"body":"maintenance","status_code":503}`)
	if err != nil {
		t.Fatalf("expected valid config: %v", err)
	}
	if canonical != `{"body":"maintenance","status_code":503}` {
		t.Fatalf("unexpected canonical json: %s", canonical)
	}
}
