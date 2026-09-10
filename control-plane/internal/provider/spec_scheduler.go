package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"github.com/goccy/go-yaml"
)

var (
	domainHostRegex  = regexp.MustCompile(`^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$`)
	backendAddrRegex = regexp.MustCompile(`^[a-zA-Z0-9.\[\]:_-]+$`)
	failTimeoutRegex = regexp.MustCompile(`^[0-9]{1,6}[smh]$`)
	sniRegex         = regexp.MustCompile(`^[a-zA-Z0-9.-]+$`)
)

// SpecScheduler is an autonomous background provider that periodically compiles
// cluster authority data into a single declarative NodeSpec snapshot and synchronizes
// it to the database with jitter to eliminate thundering herds.
type SpecScheduler struct {
	repo           repo.SpecSyncRepository
	baseInterval   time.Duration
	jitterFraction float64
	triggerCh      chan struct{}
	stopCh         chan struct{}
	wg             sync.WaitGroup
	started        bool
	mu             sync.Mutex
}

// NewSpecScheduler creates a new SpecScheduler with the specified base interval and jitter fraction.
func NewSpecScheduler(baseInterval time.Duration, jitterFraction float64) *SpecScheduler {
	if baseInterval <= 0 {
		baseInterval = 5 * time.Second
	}
	if jitterFraction < 0 || jitterFraction > 1 {
		jitterFraction = 0.20
	}
	return &SpecScheduler{
		baseInterval:   baseInterval,
		jitterFraction: jitterFraction,
		triggerCh:      make(chan struct{}, 1),
		stopCh:         make(chan struct{}),
	}
}

// Start binds the repository, executes an initial warm-up reconcile synchronously,
// and spawns the background periodic reconciliation worker.
func (s *SpecScheduler) Start(ctx context.Context, r repo.SpecSyncRepository) {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.repo = r
	s.started = true
	s.mu.Unlock()

	// Initial synchronous warm-up reconcile so active spec release is ready immediately
	if s.repo != nil {
		if _, err := s.Reconcile(ctx); err != nil {
			log.Printf("[SpecScheduler] Initial warm-up reconcile warning: %v", err)
		} else {
			log.Printf("[SpecScheduler] Initial warm-up reconcile completed successfully")
		}
	}

	s.wg.Add(1)
	go s.runLoop()
}

// Stop gracefully shuts down the background synchronization worker.
func (s *SpecScheduler) Stop() {
	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		return
	}
	close(s.stopCh)
	s.started = false
	s.mu.Unlock()

	s.wg.Wait()
	log.Printf("[SpecScheduler] Stopped background worker")
}

// TriggerReconcile requests an immediate out-of-band reconciliation without blocking.
func (s *SpecScheduler) TriggerReconcile() {
	select {
	case s.triggerCh <- struct{}{}:
	default:
	}
}

// calculateNextInterval returns a randomized tick duration incorporating jitter.
func (s *SpecScheduler) calculateNextInterval() time.Duration {
	if s.jitterFraction <= 0 {
		return s.baseInterval
	}
	factor := 1.0 + s.jitterFraction*(rand.Float64()*2.0-1.0)
	d := time.Duration(float64(s.baseInterval) * factor)
	if d < 100*time.Millisecond {
		d = 100 * time.Millisecond
	}
	return d
}

// runLoop executes the event-driven reconciliation loop.
// It remains completely idle (0 CPU / 0 queries) until woken by a mutation trigger or shutdown signal.
func (s *SpecScheduler) runLoop() {
	defer s.wg.Done()

	for {
		select {
		case <-s.stopCh:
			return
		case <-s.triggerCh:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			if _, err := s.Reconcile(ctx); err != nil {
				log.Printf("[SpecScheduler] Reconcile (triggered) failed: %v", err)
			}
			cancel()
		}
	}
}

// Reconcile gathers cluster authority data, compiles a canonical NodeSpec YAML document,
// and persists a new release if the content digest has changed.
func (s *SpecScheduler) Reconcile(ctx context.Context) (*entity.ClusterSpecRelease, error) {
	s.mu.Lock()
	r := s.repo
	s.mu.Unlock()

	if r == nil {
		return nil, fmt.Errorf("repository is nil")
	}

	auth, err := r.GetAuthorityData(ctx, "")
	if err != nil {
		return nil, fmt.Errorf("failed to get authority data: %w", err)
	}

	doc, yamlStr, calculatedHash, err := s.compileDocument(auth)
	if err != nil {
		return nil, fmt.Errorf("failed to compile document: %w", err)
	}

	active, err := r.GetActiveSpecRelease(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get active spec release: %w", err)
	}

	if active != nil && active.Digest == calculatedHash {
		return active, nil
	}

	newRelease, err := r.PublishSpecRelease(ctx, entity.ClusterSpecRelease{
		Digest:        calculatedHash,
		SpecYAML:      yamlStr,
		Actor:         "spec-scheduler",
		ChangeSummary: fmt.Sprintf("Cluster NodeSpec compiled with %d extensions, %d routes", len(doc.Extensions), len(auth.RoutingRecords)),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to publish spec release: %w", err)
	}

	log.Printf("[SpecScheduler] Published updated spec release v%d (digest: %s)", newRelease.ID, newRelease.Digest[:12])
	return newRelease, nil
}

func (s *SpecScheduler) compileDocument(auth *entity.SpecAuthorityData) (*entity.NodeSpecDocument, string, string, error) {
	releaseID := int64(1)
	if auth != nil {
		if auth.WAFReleaseID > 0 {
			releaseID = auth.WAFReleaseID
		} else if auth.AccessReleaseID > 0 {
			releaseID = auth.AccessReleaseID
		}
	}

	doc := entity.NodeSpecDocument{
		Version:     1,
		ReleaseID:   releaseID,
		GeneratedAt: "2026-01-01T00:00:00Z",
		NodeID:      "cluster",
		Extensions:  make(map[string]map[string]interface{}),
		WAF: entity.WAFSpec{
			Mode: "enforce",
		},
	}

	if auth != nil {
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
					cleaned, ok := cleanJSONFloats(cfg).(map[string]interface{})
					if ok {
						extensionsMap[ext.ID] = cleaned
						if ext.ID == "prometheus" {
							extensionsMap["metrics"] = cleaned
						}
					} else {
						extensionsMap[ext.ID] = cfg
						if ext.ID == "prometheus" {
							extensionsMap["metrics"] = cfg
						}
					}
				}
			}
			if len(extensionsMap) > 0 {
				doc.Extensions = extensionsMap
			}
		}
	}

	yamlBytes, err := yaml.Marshal(doc)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to marshal node spec YAML: %w", err)
	}

	h := sha256.Sum256(yamlBytes)
	hashStr := hex.EncodeToString(h[:])

	return &doc, string(yamlBytes), hashStr, nil
}

func (s *SpecScheduler) renderRoutingConfig(records []entity.SpecRoutingRecord) (string, error) {
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
		directive := "grpc"
		grpcScheme := "grpc"
		if scheme == "https" {
			grpcScheme = "grpcs"
		}
		fmt.Fprintf(&config, "grpc_pass %s://%s;\ngrpc_set_header Host $host;\ngrpc_set_header X-Real-IP $remote_addr;\ngrpc_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\ngrpc_read_timeout 1h;\ngrpc_send_timeout 1h;\n", grpcScheme, name)

		if scheme == "https" {
			fmt.Fprintf(&config, "%s_ssl_server_name on;\n%s_ssl_session_reuse off;\n", directive, directive)
			caPath := "/etc/ssl/certs/ca-certificates.crt"
			if ssl.MTLS && (!ssl.Enabled || !ssl.Verify || ssl.ClientCert == "" || ssl.ClientKey == "") {
				return "", fmt.Errorf("invalid mTLS routing credentials")
			}
			for _, asset := range []struct{ content, directive string }{
				{ssl.CA, "grpc_ssl_trusted_certificate"},
				{ssl.ClientCert, "grpc_ssl_certificate"},
				{ssl.ClientKey, "grpc_ssl_certificate_key"},
			} {
				if asset.content == "" || (asset.directive != "grpc_ssl_trusted_certificate" && !ssl.MTLS) {
					continue
				}
				sum := sha256.Sum256([]byte(asset.content))
				name := hex.EncodeToString(sum[:]) + ".pem"
				path := "/var/lib/aurora-routing/certificates/" + name
				if asset.directive == "grpc_ssl_trusted_certificate" {
					caPath = path
				} else {
					fmt.Fprintf(&config, "%s %s;\n", asset.directive, path)
				}
			}
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

func cleanJSONFloats(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		res := make(map[string]interface{}, len(val))
		for k, v2 := range val {
			res[k] = cleanJSONFloats(v2)
		}
		return res
	case []interface{}:
		res := make([]interface{}, len(val))
		for i, v2 := range val {
			res[i] = cleanJSONFloats(v2)
		}
		return res
	case float64:
		if val == math.Trunc(val) && !math.IsNaN(val) && !math.IsInf(val, 0) {
			return int64(val)
		}
		return val
	default:
		return val
	}
}
