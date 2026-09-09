package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"github.com/goccy/go-yaml"
)

var domainHostRegex = regexp.MustCompile(`^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`)
var backendAddrRegex = regexp.MustCompile(`^[a-zA-Z0-9.\[\]:_-]+$`)
var failTimeoutRegex = regexp.MustCompile(`^[0-9]{1,6}[smh]$`)
var sniRegex = regexp.MustCompile(`^[a-zA-Z0-9.-]+$`)

// SpecSyncService is the unified workflow owner for node declarative configuration synchronization.
type SpecSyncService struct {
	repo repo.SpecSyncRepository
}

func NewSpecSyncService(repo repo.SpecSyncRepository) *SpecSyncService {
	return &SpecSyncService{
		repo: repo,
	}
}

func (s *SpecSyncService) SyncSpec(ctx context.Context, q entity.SpecSyncQuery) (*entity.SpecSyncResult, error) {
	if q.NodeID == "" {
		return nil, fmt.Errorf("node_id is required")
	}

	doc := entity.NodeSpecDocument{
		Version:     1,
		ReleaseID:   time.Now().Unix(),
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		NodeID:      q.NodeID,
		Extensions:  make(map[string]map[string]interface{}),
		WAF: entity.WAFSpec{
			Mode: "enforce",
		},
	}

	if s.repo != nil {
		auth, err := s.repo.GetAuthorityData(ctx, q.NodeID)
		if err != nil {
			return nil, err
		}

		if auth.WAFReleaseID > 0 {
			doc.ReleaseID = auth.WAFReleaseID
		} else if auth.AccessReleaseID > 0 {
			doc.ReleaseID = auth.AccessReleaseID
		}

		if len(auth.WAFPayload) > 0 {
			doc.WAF.RawJSON = string(auth.WAFPayload)
		}
		if len(auth.AccessPayload) > 0 {
			doc.Access.RawJSON = string(auth.AccessPayload)
		}

		doc.UpstreamsConf = auth.UpstreamsConf

		routingConf, err := s.renderRoutingConfig(auth.RoutingRecords)
		if err == nil {
			doc.RoutingConf = routingConf
		}

		if len(auth.Extensions) > 0 {
			extensionsMap := make(map[string]map[string]interface{})
			for _, ext := range auth.Extensions {
				var cfg map[string]interface{}
				if err := json.Unmarshal([]byte(ext.ConfigJSON), &cfg); err == nil {
					cfg["enabled"] = ext.Enabled
					extensionsMap[ext.ID] = cfg
				}
			}
			if len(extensionsMap) > 0 {
				doc.Extensions = extensionsMap
			}
		}
	}

	// Serialize doc to YAML
	yamlBytes, err := yaml.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal node spec YAML: %w", err)
	}

	h := sha256.Sum256(yamlBytes)
	hashStr := hex.EncodeToString(h[:])

	if q.CurrentHash != "" && q.CurrentHash == hashStr {
		// In sync! 0 bytes YAML payload
		return &entity.SpecSyncResult{
			InSync:    true,
			ReleaseID: doc.ReleaseID,
			Hash:      hashStr,
			SpecYAML:  "",
		}, nil
	}

	return &entity.SpecSyncResult{
		InSync:    false,
		ReleaseID: doc.ReleaseID,
		Hash:      hashStr,
		SpecYAML:  string(yamlBytes),
	}, nil
}

func (s *SpecSyncService) ReportSpec(ctx context.Context, cmd entity.SpecReportCommand) error {
	if s.repo == nil {
		return nil
	}
	return s.repo.RecordReport(ctx, cmd)
}

func (s *SpecSyncService) renderRoutingConfig(records []entity.SpecRoutingRecord) (string, error) {
	if len(records) == 0 {
		return "# No domain routes configured\n", nil
	}

	var config strings.Builder
	config.WriteString("map $http_upgrade $aurora_route_connection { default upgrade; '' ''; }\n")

	for _, d := range records {
		if !domainHostRegex.MatchString(d.Host) || strings.Contains(d.Host, "..") {
			return "", fmt.Errorf("invalid domain %d: invalid host %q", d.ID, d.Host)
		}

		name := fmt.Sprintf("aurora_route_%d", d.ID)
		var transport struct {
			RequestCompression string `json:"requestCompression"`
			HTTPVersion        string `json:"httpVersion"`
			EnableWebSocket    bool   `json:"enableWebSocket"`
			EnableSSE          bool   `json:"enableSse"`
			EnableGRPC         bool   `json:"enableGrpc"`
			KeepAlive          int    `json:"keepAliveConnections"`
			KeepAliveTimeout   int    `json:"keepAliveTimeout"`
		}
		var ssl struct {
			Enabled    bool   `json:"enabled"`
			Verify     bool   `json:"verifyCert"`
			SNI        string `json:"sniHost"`
			CA         string `json:"caCert"`
			MTLS       bool   `json:"mTLS"`
			ClientCert string `json:"clientCert"`
			ClientKey  string `json:"clientKey"`
		}
		var nodes []struct {
			Address     string `json:"address"`
			Weight      int    `json:"weight"`
			MaxFails    int    `json:"maxFails"`
			FailTimeout string `json:"failTimeout"`
			Backup      bool   `json:"backup"`
		}
		scheme := "http"
		sni := ""

		if d.ServersJSON != "" {
			if err := json.Unmarshal([]byte(d.ServersJSON), &nodes); err != nil {
				return "", err
			}
			if d.TransportJSON != "" {
				_ = json.Unmarshal([]byte(d.TransportJSON), &transport)
			}
			if d.SSLJSON != "" {
				_ = json.Unmarshal([]byte(d.SSLJSON), &ssl)
			}
			if ssl.Enabled {
				scheme = "https"
				sni = ssl.SNI
			}
		} else if d.Target != "" {
			u, err := url.Parse(d.Target)
			if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
				return "", fmt.Errorf("domain %d references missing pool or invalid origin", d.ID)
			}
			scheme = u.Scheme
			if u.Port() == "" && scheme == "https" {
				u.Host += ":443"
			}
			sni = u.Hostname()
			ssl.Verify = true
			nodes = append(nodes, struct {
				Address     string `json:"address"`
				Weight      int    `json:"weight"`
				MaxFails    int    `json:"maxFails"`
				FailTimeout string `json:"failTimeout"`
				Backup      bool   `json:"backup"`
			}{Address: u.Host, Weight: 1})
		}

		if len(nodes) == 0 {
			continue
		}

		if transport.HTTPVersion == "HTTP/3" || (transport.RequestCompression != "" && transport.RequestCompression != "none") || (d.ProbesJSON != "" && d.ProbesJSON != "[]" && d.ProbesJSON != "null") {
			fmt.Fprintf(&config, "server { listen 80; server_name %s; include /etc/nginx/domain-waf.conf; return 503; }\n", d.Host)
			continue
		}

		fmt.Fprintf(&config, "upstream %s {\n", name)
		if d.DynamicDNS {
			fmt.Fprintf(&config, "zone %s 256k;\nresolver 127.0.0.11 valid=5s ipv6=off;\nresolver_timeout 2s;\n", name)
		}
		switch d.Algorithm {
		case "", "round_robin":
		case "least_conn", "ip_hash":
			fmt.Fprintf(&config, "%s;\n", d.Algorithm)
		default:
			return "", fmt.Errorf("invalid algorithm %q", d.Algorithm)
		}

		for _, n := range nodes {
			if !backendAddrRegex.MatchString(n.Address) || n.Weight < 0 || n.MaxFails < 0 || n.Weight > 10000 || n.MaxFails > 10000 {
				return "", fmt.Errorf("invalid backend address or limits")
			}
			if n.FailTimeout != "" && !failTimeoutRegex.MatchString(n.FailTimeout) {
				return "", fmt.Errorf("invalid fail timeout")
			}
			if n.Weight == 0 {
				n.Weight = 1
			}
			if scheme == "https" {
				u, e := url.Parse("https://" + n.Address)
				if e != nil {
					return "", fmt.Errorf("invalid HTTPS origin")
				}
				if u.Port() == "" {
					n.Address += ":443"
				}
			}
			fmt.Fprintf(&config, "server %s weight=%d max_fails=%d", n.Address, n.Weight, n.MaxFails)
			if d.DynamicDNS {
				config.WriteString(" resolve")
			}
			if n.FailTimeout != "" {
				fmt.Fprintf(&config, " fail_timeout=%s", n.FailTimeout)
			}
			if n.Backup {
				if d.Algorithm == "ip_hash" {
					return "", fmt.Errorf("ip_hash cannot use backup peers")
				}
				config.WriteString(" backup")
			}
			config.WriteString(";\n")
		}

		if transport.KeepAlive <= 0 {
			transport.KeepAlive = 32
		}
		if transport.KeepAlive > 4096 {
			return "", fmt.Errorf("keepalive limit exceeded")
		}
		if transport.KeepAliveTimeout > 0 {
			fmt.Fprintf(&config, "keepalive_timeout %ds;\n", transport.KeepAliveTimeout)
		}

		fmt.Fprintf(&config, "keepalive %d;\n}\nserver {\nlisten 80;\nserver_name %s;\ninclude /etc/nginx/domain-waf.conf;\n", transport.KeepAlive, d.Host)
		if d.Status != "Active" {
			config.WriteString("return 503;\n}\n")
			continue
		}

		config.WriteString("location / {\n")
		version := "1.1"
		if transport.HTTPVersion == "HTTP/1.0" {
			version = "1.0"
		} else if transport.HTTPVersion == "HTTP/2" {
			version = "2"
		}

		directive := "proxy"
		if transport.EnableGRPC {
			if version != "2" {
				return "", fmt.Errorf("gRPC requires HTTP/2")
			}
			directive = "grpc"
			grpcScheme := "grpc"
			if scheme == "https" {
				grpcScheme = "grpcs"
			}
			fmt.Fprintf(&config, "grpc_pass %s://%s;\ngrpc_set_header Host $host;\ngrpc_set_header X-Real-IP $remote_addr;\ngrpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\ngrpc_read_timeout 1h;\ngrpc_send_timeout 1h;\n", grpcScheme, name)
		} else {
			fmt.Fprintf(&config, "proxy_pass %s://%s;\nproxy_http_version %s;\nproxy_set_header Host $host;\nproxy_set_header X-Real-IP $remote_addr;\nproxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n", scheme, name, version)
			if transport.EnableWebSocket {
				config.WriteString("proxy_set_header Upgrade $http_upgrade;\nproxy_set_header Connection $aurora_route_connection;\n")
			} else {
				config.WriteString("proxy_set_header Connection '';\n")
			}
			if transport.EnableSSE {
				config.WriteString("proxy_buffering off;\nproxy_read_timeout 1h;\n")
			}
		}

		if scheme == "https" {
			fmt.Fprintf(&config, "%s_ssl_server_name on;\n%s_ssl_session_reuse off;\n", directive, directive)
			caPath := "/etc/ssl/certs/ca-certificates.crt"
			if sni != "" {
				if !sniRegex.MatchString(sni) {
					return "", fmt.Errorf("invalid origin SNI")
				}
				fmt.Fprintf(&config, "%s_ssl_name %s;\n", directive, sni)
			}
			if ssl.Verify {
				if sni == "" {
					return "", fmt.Errorf("verified TLS pool requires SNI hostname")
				}
				fmt.Fprintf(&config, "%s_ssl_verify on;\n%s_ssl_verify_depth 5;\n%s_ssl_trusted_certificate %s;\n", directive, directive, directive, caPath)
			}
		}
		fmt.Fprintf(&config, "%s_connect_timeout 2s;\n%s_next_upstream error timeout http_502 http_503 http_504;\n%s_next_upstream_tries 3;\n}\n}\n", directive, directive, directive)
	}

	hash := sha256.Sum256([]byte(config.String()))
	digest := hex.EncodeToString(hash[:])
	fmt.Fprintf(&config, "server { listen 127.0.0.1:9082; location = /routing-digest { return 200 '%s'; } }\n", digest)
	return "# routing-digest: " + digest + "\n" + config.String(), nil
}
