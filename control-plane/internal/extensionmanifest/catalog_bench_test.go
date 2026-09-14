package extensionmanifest_test

import (
	"testing"

	"aurora-waf.local/control-plane/internal/extensionmanifest"
)

func BenchmarkAllManifests(b *testing.B) {
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		manifests, err := extensionmanifest.All()
		if err != nil {
			b.Fatalf("failed to get all manifests: %v", err)
		}
		if len(manifests) == 0 {
			b.Fatal("expected non-empty catalog")
		}
	}
}

func BenchmarkDigest(b *testing.B) {
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		digest, err := extensionmanifest.Digest()
		if err != nil {
			b.Fatalf("failed to calculate digest: %v", err)
		}
		if len(digest) != 64 {
			b.Fatalf("expected 64-char sha256 hex digest, got %s", digest)
		}
	}
}

func BenchmarkValidateConfig_ValidStdLog(b *testing.B) {
	manifest, ok := extensionmanifest.Find("builtin/std-log", 1)
	if !ok {
		b.Fatal("std-log manifest not found")
	}
	validConfig := `{"enabled":true,"format":"json","split_streams":true,"log_level":"info","include_waf_details":true}`

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := extensionmanifest.ValidateConfig(manifest, validConfig)
		if err != nil {
			b.Fatalf("validation failed: %v", err)
		}
	}
}

func BenchmarkValidateConfig_ValidOpenTelemetryLogs(b *testing.B) {
	manifest, ok := extensionmanifest.Find("builtin/opentelemetry-logs", 1)
	if !ok {
		b.Fatal("opentelemetry-logs manifest not found")
	}
	validConfig := `{"enabled":true,"endpoint":"http://otel-collector:4318","protocol":"http","batch_size":100,"flush_interval_ms":1000,"timeout_ms":3000,"service_name":"aurora-gateway","log_level":"info"}`

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := extensionmanifest.ValidateConfig(manifest, validConfig)
		if err != nil {
			b.Fatalf("validation failed: %v", err)
		}
	}
}

func BenchmarkValidateConfig_InvalidRejection(b *testing.B) {
	manifest, ok := extensionmanifest.Find("builtin/std-log", 1)
	if !ok {
		b.Fatal("std-log manifest not found")
	}
	// Missing format & invalid log_level
	invalidConfig := `{"enabled":true,"split_streams":true,"log_level":"debug","include_waf_details":true}`

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := extensionmanifest.ValidateConfig(manifest, invalidConfig)
		if err == nil {
			b.Fatal("expected validation failure, got nil")
		}
	}
}
