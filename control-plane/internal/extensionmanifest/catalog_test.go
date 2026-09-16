package extensionmanifest

import "testing"

func TestCatalogDefaultsMatchTheirRuntimeSchemas(t *testing.T) {
	manifests, err := All()
	if err != nil {
		t.Fatalf("load catalog: %v", err)
	}
	if len(manifests) != 24 {
		t.Fatalf("expected 24 packaged manifests, got %d", len(manifests))
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

func TestOpenTelemetryManifestValidation(t *testing.T) {
	manifest, ok := Find("builtin/opentelemetry-metrics", 1)
	if !ok {
		t.Fatal("OpenTelemetry manifest not installed")
	}
	valid := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":15,"timeout_ms":5000,"service_name":"aurora-gateway"}`
	if _, err := ValidateConfig(manifest, valid); err != nil {
		t.Fatalf("expected valid OpenTelemetry config: %v", err)
	}

	validGrpc := `{"enabled":true,"endpoint":"http://127.0.0.1:4317","protocol":"grpc","interval_secs":30,"timeout_ms":2000,"service_name":"aurora-grpc"}`
	if _, err := ValidateConfig(manifest, validGrpc); err != nil {
		t.Fatalf("expected valid gRPC OpenTelemetry config: %v", err)
	}

	// Missing endpoint should fail
	invalidEndpoint := `{"enabled":true,"protocol":"http","interval_secs":15,"timeout_ms":5000,"service_name":"aurora"}`
	if _, err := ValidateConfig(manifest, invalidEndpoint); err == nil {
		t.Fatal("expected config missing endpoint to be rejected")
	}

	// Missing timeout_ms should fail (no fallback)
	invalidTimeout := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":15,"service_name":"aurora"}`
	if _, err := ValidateConfig(manifest, invalidTimeout); err == nil {
		t.Fatal("expected config missing timeout_ms to be rejected")
	}

	// Missing service_name should fail (no fallback)
	invalidServiceName := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","interval_secs":15,"timeout_ms":5000}`
	if _, err := ValidateConfig(manifest, invalidServiceName); err == nil {
		t.Fatal("expected config missing service_name to be rejected")
	}

	// Invalid protocol should fail
	invalidProto := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"udp","interval_secs":15,"timeout_ms":5000,"service_name":"aurora"}`
	if _, err := ValidateConfig(manifest, invalidProto); err == nil {
		t.Fatal("expected invalid protocol to be rejected")
	}
}

func TestOpenTelemetryLogsManifestValidation(t *testing.T) {
	manifest, ok := Find("builtin/opentelemetry-logs", 1)
	if !ok {
		t.Fatal("OpenTelemetry Logs manifest not installed")
	}
	valid := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora-gateway","log_level":"info"}`
	if _, err := ValidateConfig(manifest, valid); err != nil {
		t.Fatalf("expected valid OpenTelemetry Logs config: %v", err)
	}

	validGrpc := `{"enabled":true,"endpoint":"http://127.0.0.1:4317","protocol":"grpc","batch_size":500,"flush_interval_ms":1000,"timeout_ms":3000,"service_name":"aurora-grpc","log_level":"all"}`
	if _, err := ValidateConfig(manifest, validGrpc); err != nil {
		t.Fatalf("expected valid gRPC OpenTelemetry Logs config: %v", err)
	}

	// Missing endpoint should fail
	invalidEndpoint := `{"enabled":true,"protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora","log_level":"info"}`
	if _, err := ValidateConfig(manifest, invalidEndpoint); err == nil {
		t.Fatal("expected config missing endpoint to be rejected")
	}

	// Missing batch_size should fail
	invalidBatch := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora","log_level":"info"}`
	if _, err := ValidateConfig(manifest, invalidBatch); err == nil {
		t.Fatal("expected config missing batch_size to be rejected")
	}

	// Missing flush_interval_ms should fail
	invalidFlush := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"timeout_ms":5000,"service_name":"aurora","log_level":"info"}`
	if _, err := ValidateConfig(manifest, invalidFlush); err == nil {
		t.Fatal("expected config missing flush_interval_ms to be rejected")
	}

	// Missing timeout_ms should fail
	invalidTimeout := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"service_name":"aurora","log_level":"info"}`
	if _, err := ValidateConfig(manifest, invalidTimeout); err == nil {
		t.Fatal("expected config missing timeout_ms to be rejected")
	}

	// Missing service_name should fail
	invalidService := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"log_level":"info"}`
	if _, err := ValidateConfig(manifest, invalidService); err == nil {
		t.Fatal("expected config missing service_name to be rejected")
	}

	// Missing log_level should fail
	invalidLogLevel := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora"}`
	if _, err := ValidateConfig(manifest, invalidLogLevel); err == nil {
		t.Fatal("expected config missing log_level to be rejected")
	}

	// Invalid protocol should fail
	invalidProto := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"udp","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora","log_level":"info"}`
	if _, err := ValidateConfig(manifest, invalidProto); err == nil {
		t.Fatal("expected invalid protocol to be rejected")
	}

	// Invalid log_level enum should fail
	invalidLevelEnum := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora","log_level":"verbose"}`
	if _, err := ValidateConfig(manifest, invalidLevelEnum); err == nil {
		t.Fatal("expected invalid log_level enum to be rejected")
	}
}

func TestOpenTelemetryTracingManifestValidation(t *testing.T) {
	manifest, ok := Find("builtin/opentelemetry-tracing", 1)
	if !ok {
		t.Fatal("OpenTelemetry Tracing manifest not installed")
	}
	valid := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","sample_rate":1.0,"batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora-gateway"}`
	if _, err := ValidateConfig(manifest, valid); err != nil {
		t.Fatalf("expected valid OpenTelemetry Tracing config: %v", err)
	}

	validGrpc := `{"enabled":true,"endpoint":"http://127.0.0.1:4317","protocol":"grpc","sample_rate":0.5,"batch_size":500,"flush_interval_ms":1000,"timeout_ms":3000,"service_name":"aurora-grpc"}`
	if _, err := ValidateConfig(manifest, validGrpc); err != nil {
		t.Fatalf("expected valid gRPC OpenTelemetry Tracing config: %v", err)
	}

	// Missing endpoint should fail
	invalidEndpoint := `{"enabled":true,"protocol":"http","sample_rate":1.0,"batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora"}`
	if _, err := ValidateConfig(manifest, invalidEndpoint); err == nil {
		t.Fatal("expected config missing endpoint to be rejected")
	}

	// Missing sample_rate should fail
	invalidSample := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"http","batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora"}`
	if _, err := ValidateConfig(manifest, invalidSample); err == nil {
		t.Fatal("expected config missing sample_rate to be rejected")
	}

	// Invalid protocol should fail
	invalidProto := `{"enabled":true,"endpoint":"http://127.0.0.1:4318","protocol":"udp","sample_rate":1.0,"batch_size":100,"flush_interval_ms":2000,"timeout_ms":5000,"service_name":"aurora"}`
	if _, err := ValidateConfig(manifest, invalidProto); err == nil {
		t.Fatal("expected invalid protocol to be rejected")
	}
}

func TestStdLogManifestValidation(t *testing.T) {
	manifest, ok := Find("builtin/std-log", 1)
	if !ok {
		t.Fatal("std-log manifest not found in catalog")
	}

	// Valid default config
	valid := `{"enabled":true,"format":"json","split_streams":true,"log_level":"info","include_waf_details":true}`
	if _, err := ValidateConfig(manifest, valid); err != nil {
		t.Fatalf("expected valid std-log config: %v", err)
	}

	// Valid text format
	validText := `{"enabled":true,"format":"text","split_streams":false,"log_level":"warn","include_waf_details":false}`
	if _, err := ValidateConfig(manifest, validText); err != nil {
		t.Fatalf("expected valid text std-log config: %v", err)
	}

	// Invalid format enum
	invalidFormat := `{"enabled":true,"format":"xml","split_streams":true,"log_level":"info","include_waf_details":true}`
	if _, err := ValidateConfig(manifest, invalidFormat); err == nil {
		t.Fatal("expected invalid format to be rejected")
	}

	// Invalid log_level enum
	invalidLogLevel := `{"enabled":true,"format":"json","split_streams":true,"log_level":"debug","include_waf_details":true}`
	if _, err := ValidateConfig(manifest, invalidLogLevel); err == nil {
		t.Fatal("expected invalid log_level to be rejected")
	}

	// Missing format
	missingFormat := `{"enabled":true,"split_streams":true,"log_level":"info","include_waf_details":true}`
	if _, err := ValidateConfig(manifest, missingFormat); err == nil {
		t.Fatal("expected missing format to be rejected")
	}

	// Missing split_streams
	missingSplit := `{"enabled":true,"format":"json","log_level":"info","include_waf_details":true}`
	if _, err := ValidateConfig(manifest, missingSplit); err == nil {
		t.Fatal("expected missing split_streams to be rejected")
	}
}
