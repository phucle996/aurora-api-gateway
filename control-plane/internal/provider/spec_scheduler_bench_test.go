package provider_test

import (
	"context"
	"fmt"
	"io"
	"log"
	"testing"
	"time"

	"github.com/phucle996/aurora-api-gateway/control-plane/internal/domain/entity"
	"github.com/phucle996/aurora-api-gateway/control-plane/internal/provider"
)

func init() {
	log.SetOutput(io.Discard)
}

func buildAuthorityData(routesCount, upstreamsCount, extensionsCount, l4ServicesCount int) *entity.SpecAuthorityData {
	routes := make([]entity.SpecRoutingRecord, 0, routesCount)
	for i := 0; i < routesCount; i++ {
		routes = append(routes, entity.SpecRoutingRecord{
			ID:        int64(i + 1),
			Host:      fmt.Sprintf("route-%d.aurora.local", i),
			Status:    "Active",
			Target:    fmt.Sprintf("http://upstream-%d:8080", i%upstreamsCount),
			Algorithm: "round_robin",
		})
	}

	extensions := make([]entity.SpecExtensionRecord, 0, extensionsCount)
	extKeys := []struct {
		id      string
		key     string
		version uint32
		config  string
	}{
		{"std-log", "builtin/std-log", 1, `{"enabled":true,"format":"json","split_streams":true,"log_level":"info","include_waf_details":true}`},
		{"opentelemetry-logs", "builtin/opentelemetry-logs", 1, `{"enabled":true,"endpoint":"http://otel-collector:4318","protocol":"http","batch_size":100,"flush_interval_ms":1000,"timeout_ms":3000,"service_name":"aurora-gateway","log_level":"info"}`},
		{"prometheus", "builtin/prometheus", 1, `{"port":9145,"prometheus":{"enabled":true,"path":"/metrics"}}`},
	}
	for i := 0; i < extensionsCount; i++ {
		template := extKeys[i%len(extKeys)]
		extensions = append(extensions, entity.SpecExtensionRecord{
			ID:              fmt.Sprintf("%s-%d", template.id, i),
			ManifestKey:     template.key,
			ManifestVersion: template.version,
			ConfigJSON:      template.config,
		})
	}

	l4Services := make([]entity.SpecL4ServiceRecord, 0, l4ServicesCount)
	for i := 0; i < l4ServicesCount; i++ {
		l4Services = append(l4Services, entity.SpecL4ServiceRecord{
			ID:                  fmt.Sprintf("l4-%d", i+1),
			Name:                fmt.Sprintf("l4-svc-%d", i),
			Protocol:            "tcp",
			ListenPort:          10000 + i,
			ForwardTargetType:   "endpoint",
			DirectEndpoint:      fmt.Sprintf("10.0.0.%d:6379", (i%250)+1),
			ProxyTimeout:        "1h",
			ProxyConnectTimeout: "5s",
			Enabled:             true,
		})
	}

	return &entity.SpecAuthorityData{
		NodeID:        "node-benchmark",
		UpstreamsConf: "upstream test { server 127.0.0.1:8080; }\n",
		RoutingRecords: routes,
		Extensions:     extensions,
		L4Services:     l4Services,
	}
}

func BenchmarkCompileSpec_Small(b *testing.B) {
	ctx := context.Background()
	auth := buildAuthorityData(2, 2, 2, 2)
	mockRepo := &mockSpecSyncRepo{authorityData: auth}
	scheduler := provider.NewSpecScheduler(5*time.Second, 0.10)
	scheduler.Start(ctx, mockRepo)
	defer scheduler.Stop()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		mockRepo.mu.Lock()
		mockRepo.activeRelease = nil // force recompile
		mockRepo.mu.Unlock()

		_, err := scheduler.Reconcile(ctx)
		if err != nil {
			b.Fatalf("reconcile failed: %v", err)
		}
	}
}

func BenchmarkCompileSpec_Medium(b *testing.B) {
	ctx := context.Background()
	auth := buildAuthorityData(50, 10, 10, 20)
	mockRepo := &mockSpecSyncRepo{authorityData: auth}
	scheduler := provider.NewSpecScheduler(5*time.Second, 0.10)
	scheduler.Start(ctx, mockRepo)
	defer scheduler.Stop()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		mockRepo.mu.Lock()
		mockRepo.activeRelease = nil // force recompile
		mockRepo.mu.Unlock()

		_, err := scheduler.Reconcile(ctx)
		if err != nil {
			b.Fatalf("reconcile failed: %v", err)
		}
	}
}

func BenchmarkCompileSpec_Large(b *testing.B) {
	ctx := context.Background()
	auth := buildAuthorityData(200, 30, 23, 50)
	mockRepo := &mockSpecSyncRepo{authorityData: auth}
	scheduler := provider.NewSpecScheduler(5*time.Second, 0.10)
	scheduler.Start(ctx, mockRepo)
	defer scheduler.Stop()

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		mockRepo.mu.Lock()
		mockRepo.activeRelease = nil // force recompile
		mockRepo.mu.Unlock()

		_, err := scheduler.Reconcile(ctx)
		if err != nil {
			b.Fatalf("reconcile failed: %v", err)
		}
	}
}
