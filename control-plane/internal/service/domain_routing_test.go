package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"context"
	"strings"
	"testing"
)

type routingFixture []entity.DomainRoutingRecord

func (r routingFixture) RoutingRecords(context.Context, entity.DomainRoutingQuery) ([]entity.DomainRoutingRecord, error) {
	return r, nil
}
func TestDomainRoutingSnapshot(t *testing.T) {
	for _, tc := range []struct{ name, target, status, want string }{
		{"direct", "http://127.0.0.1:8080", "Active", "proxy_pass http://aurora_route_1;"},
		{"https-default-port", "https://origin.example.com", "Active", "server origin.example.com:443"},
		{"inactive", "http://127.0.0.1:8080", "Inactive", "return 503;"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := NewDomainRoutingService(routingFixture{{ID: 1, Host: "app.example.com", Target: tc.target, Status: tc.status}})
			a, err := s.DesiredRouting(context.Background(), entity.DomainRoutingQuery{})
			if err != nil {
				t.Fatal(err)
			}
			b, err := s.DesiredRouting(context.Background(), entity.DomainRoutingQuery{})
			if err != nil {
				t.Fatal(err)
			}
			if a.Digest != b.Digest || !strings.Contains(a.Config, tc.want) || !strings.Contains(a.Config, "include /etc/nginx/domain-waf.conf;") {
				t.Fatalf("invalid routing: %s", a.Config)
			}
		})
	}
}
func TestDomainRoutingRejectsUnsafeSnapshot(t *testing.T) {
	for _, target := range []string{"missing-pool", "http://user:pass@origin.test", "http://origin.test/path", "http://origin.test;return 200;", "file:///etc/passwd"} {
		s := NewDomainRoutingService(routingFixture{{ID: 1, Host: "app.example.com", Target: target, Status: "Active"}})
		if _, err := s.DesiredRouting(context.Background(), entity.DomainRoutingQuery{}); err == nil {
			t.Fatalf("accepted %q", target)
		}
	}
}

func TestNativeOriginTransportRouting(t *testing.T) {
	for _, tc := range []struct{ transport, want string }{
		{`{"httpVersion":"HTTP/2"}`, "proxy_http_version 2;"},
		{`{"httpVersion":"HTTP/2","enableGrpc":true}`, "grpc_pass grpc://aurora_route_1;"},
		{`{"httpVersion":"HTTP/3"}`, "return 503;"},
		{`{"httpVersion":"HTTP/2","requestCompression":"gzip"}`, "return 503;"},
	} {
		s := NewDomainRoutingService(routingFixture{{ID: 1, Host: "app.test", Status: "Active", Target: "pool", ServersJSON: `[{"address":"origin.test:8080","weight":1}]`, TransportJSON: tc.transport, SSLJSON: `{"enabled":false}`, DynamicDNS: true}})
		result, e := s.DesiredRouting(context.Background(), entity.DomainRoutingQuery{})
		if e != nil {
			t.Fatal(e)
		}
		if !strings.Contains(result.Config, tc.want) || strings.Contains(result.Config, "9083") || len(result.Files) != 0 {
			t.Fatal(result.Config)
		}
		if !strings.Contains(tc.want, "503") && !strings.Contains(result.Config, " resolve;") {
			t.Fatal("missing native DNS resolution")
		}
	}
}
