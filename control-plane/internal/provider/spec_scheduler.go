package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"aurora-waf.local/control-plane/internal/extensionmanifest"
)

// SpecScheduler is an autonomous background provider that periodically compiles
// cluster authority data into a single declarative Spec snapshot and synchronizes
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

// Reconcile gathers cluster authority data, compiles a canonical Spec YAML document,
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

	doc, jsonStr, calculatedHash, err := s.compileDocument(auth)
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
		SpecJSON:      jsonStr,
		Actor:         "spec-scheduler",
		ChangeSummary: fmt.Sprintf("Cluster Spec compiled with %d extensions, %d routes", len(doc.Extensions), len(auth.RoutingRecords)),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to publish spec release: %w", err)
	}

	log.Printf("[SpecScheduler] Published updated spec release v%d (digest: %s)", newRelease.ID, newRelease.Digest[:12])
	return newRelease, nil
}

func (s *SpecScheduler) compileDocument(auth *entity.SpecAuthorityData) (*Spec, string, string, error) {
	releaseID := int64(1)
	if auth != nil {
		if auth.WAFReleaseID > 0 {
			releaseID = auth.WAFReleaseID
		}
	}

	doc := Spec{
		Version:     1,
		ReleaseID:   releaseID,
		GeneratedAt: "2026-01-01T00:00:00Z",
		Extensions:  make([]ExtensionInstanceSpec, 0),
		WAF: WAFSpec{
			Mode: "enforce",
		},
	}

	if auth != nil {
		if len(auth.WAFPayload) > 0 {
			doc.WAF.RawJSON = string(auth.WAFPayload)
		}

		doc.UpstreamsConf = auth.UpstreamsConf

		if len(auth.RoutingRecords) > 0 {
			domainMap := make(map[string][]LocationRoutingSpec)
			domainOrder := make([]string, 0)
			for _, d := range auth.RoutingRecords {
				if d.Host == "" {
					continue
				}
				path := d.Path
				if path == "" {
					path = "/"
				}
				loc := LocationRoutingSpec{
					Path:        path,
					Upstream:    d.Target,
					StripPath:   d.StripPath,
					WebSocket:   d.WebSocket,
					Priority:    d.Priority,
					PluginsJSON: d.PluginsJSON,
				}
				var originTLS OriginTLSSpec
				if strings.TrimSpace(d.SSLJSON) != "" && json.Unmarshal([]byte(d.SSLJSON), &originTLS) == nil && originTLS.Enabled {
					loc.OriginTLS = &originTLS
				}
				if _, exists := domainMap[d.Host]; !exists {
					domainOrder = append(domainOrder, d.Host)
				}
				domainMap[d.Host] = append(domainMap[d.Host], loc)
			}
			domains := make([]DomainRoutingSpec, 0, len(domainOrder))
			for _, host := range domainOrder {
				domains = append(domains, DomainRoutingSpec{
					Host:      host,
					Locations: domainMap[host],
				})
			}
			if len(domains) > 0 {
				doc.Routing = RoutingSpec{Domains: domains}
			}
		}

		if len(auth.Certificates) > 0 {
			certs := make([]CertificateSpec, 0, len(auth.Certificates))
			for _, c := range auth.Certificates {
				var snis []string
				if err := json.Unmarshal([]byte(c.SNIsJSON), &snis); err != nil {
					snis = []string{}
				}
				certs = append(certs, CertificateSpec{
					ID:          c.ID,
					Name:        c.Name,
					SNIs:        snis,
					CertPEM:     c.CertPEM,
					KeyPEM:      c.KeyPEM,
					MTLSEnabled: c.MTLSEnabled,
					ClientCAPEM: c.ClientCAPEM,
					VerifyDepth: c.VerifyDepth,
				})
			}
			doc.Certificates = certs
		}

		if len(auth.Extensions) > 0 {
			manifestDigest, err := extensionmanifest.Digest()
			if err != nil {
				return nil, "", "", fmt.Errorf("resolve extension manifest digest: %w", err)
			}
			for _, ext := range auth.Extensions {
				manifest, ok := extensionmanifest.Find(ext.ManifestKey, ext.ManifestVersion)
				if !ok {
					return nil, "", "", fmt.Errorf("extension instance %q references unavailable manifest %s@%d", ext.ID, ext.ManifestKey, ext.ManifestVersion)
				}
				canonicalConfig, err := extensionmanifest.ValidateConfig(manifest, ext.ConfigJSON)
				if err != nil {
					return nil, "", "", fmt.Errorf("extension instance %q has invalid config: %w", ext.ID, err)
				}
				doc.Extensions = append(doc.Extensions, ExtensionInstanceSpec{
					InstanceID:     ext.ID,
					Key:            ext.ManifestKey,
					Version:        ext.ManifestVersion,
					ManifestDigest: manifestDigest,
					ConfigJSON:     canonicalConfig,
				})
			}
		}

		if len(auth.L4Services) > 0 {
			referencedUpstreams := make(map[string]bool)
			for _, s := range auth.L4Services {
				if (s.ForwardTargetType == "" || s.ForwardTargetType == "upstream") && s.UpstreamName != "" {
					referencedUpstreams[s.UpstreamName] = true
				}
			}

			l4Spec := &L4Spec{
				Upstreams: make([]L4UpstreamSpec, 0, len(referencedUpstreams)),
				Services:  make([]L4ServiceSpec, 0, len(auth.L4Services)),
			}

			for _, u := range auth.UpstreamRecords {
				if referencedUpstreams[u.Name] {
					var servers []struct {
						Address     string `json:"address"`
						Weight      int    `json:"weight"`
						MaxFails    int    `json:"maxFails"`
						FailTimeout string `json:"failTimeout"`
						Backup      bool   `json:"backup"`
					}
					if err := json.Unmarshal([]byte(u.ServersJSON), &servers); err != nil {
						servers = nil
					}
					l4Servers := make([]L4ServerSpec, 0, len(servers))
					for _, srv := range servers {
						l4Servers = append(l4Servers, L4ServerSpec{
							Addr:        srv.Address,
							Weight:      srv.Weight,
							MaxFails:    srv.MaxFails,
							FailTimeout: srv.FailTimeout,
							Backup:      srv.Backup,
						})
					}
					algo := u.Algorithm
					if algo == "" {
						algo = "round_robin"
					}
					l4Spec.Upstreams = append(l4Spec.Upstreams, L4UpstreamSpec{
						Name:      u.Name,
						Protocol:  "tcp",
						Algorithm: algo,
						Servers:   l4Servers,
					})
				}
			}

			for _, s := range auth.L4Services {
				var acls []L4ACLRuleSpec
				aclJSON := strings.TrimSpace(s.ACLRulesJSON)
				if aclJSON == "" {
					aclJSON = "[]"
				}
				if err := json.Unmarshal([]byte(aclJSON), &acls); err != nil {
					return nil, "", "", fmt.Errorf("parse L4 ACL for service %q: %w", s.Name, err)
				}
				sort.Slice(acls, func(i, j int) bool {
					return acls[i].Priority > acls[j].Priority
				})
				targetType := s.ForwardTargetType
				if targetType == "" {
					targetType = "upstream"
				}
				l4Spec.Services = append(l4Spec.Services, L4ServiceSpec{
					Name:                s.Name,
					Protocol:            s.Protocol,
					ListenPort:          s.ListenPort,
					ForwardTargetType:   targetType,
					Upstream:            s.UpstreamName,
					Endpoint:            s.DirectEndpoint,
					ACL:                 acls,
					ProxyTimeout:        s.ProxyTimeout,
					ProxyConnectTimeout: s.ProxyConnectTimeout,
					Enabled:             s.Enabled,
				})
			}
			doc.L4 = l4Spec
		}
	}

	jsonBytes, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to marshal node spec JSON: %w", err)
	}

	h := sha256.Sum256(jsonBytes)
	hashStr := hex.EncodeToString(h[:])

	return &doc, string(jsonBytes), hashStr, nil
}

// Spec represents the declarative specification for the Aurora gateway cluster.
type Spec struct {
	Version       uint32                  `yaml:"version" json:"version"`
	ReleaseID     int64                   `yaml:"release_id" json:"release_id"`
	GeneratedAt   string                  `yaml:"generated_at" json:"generated_at"`
	Extensions    []ExtensionInstanceSpec `yaml:"extensions,omitempty" json:"extensions,omitempty"`
	WAF           WAFSpec                 `yaml:"waf" json:"waf"`
	Upstreams     []UpstreamSpec          `yaml:"upstreams,omitempty" json:"upstreams,omitempty"`
	UpstreamsConf string                  `yaml:"upstreams_conf,omitempty" json:"upstreams_conf,omitempty"`
	Routing       RoutingSpec             `yaml:"routing,omitempty" json:"routing,omitempty"`
	RoutingConf   string                  `yaml:"routing_conf,omitempty" json:"routing_conf,omitempty"`
	Certificates  []CertificateSpec       `yaml:"certificates,omitempty" json:"certificates,omitempty"`
	L4            *L4Spec                 `yaml:"l4,omitempty" json:"l4,omitempty"`
}

type WAFSpec struct {
	Mode       string   `yaml:"mode" json:"mode"`
	BlockPaths []string `yaml:"block_paths,omitempty" json:"block_paths,omitempty"`
	RawJSON    string   `yaml:"raw_json,omitempty" json:"raw_json,omitempty"`
}

type ExtensionInstanceSpec struct {
	InstanceID     string `yaml:"instance_id" json:"instance_id"`
	Key            string `yaml:"key" json:"key"`
	Version        uint32 `yaml:"version" json:"version"`
	ManifestDigest string `yaml:"manifest_digest" json:"manifest_digest"`
	ConfigJSON     string `yaml:"config_json" json:"config_json"`
}

type UpstreamSpec struct {
	Name string `yaml:"name" json:"name"`

	Servers []UpstreamServerSpec `yaml:"servers" json:"servers"`
}

type UpstreamServerSpec struct {
	Addr   string `yaml:"addr" json:"addr"`
	Weight uint32 `yaml:"weight" json:"weight"`
}

type RoutingSpec struct {
	Domains []DomainRoutingSpec `yaml:"domains,omitempty" json:"domains,omitempty"`
}

type DomainRoutingSpec struct {
	Host      string                `yaml:"host" json:"host"`
	Locations []LocationRoutingSpec `yaml:"locations,omitempty" json:"locations,omitempty"`
}

type LocationRoutingSpec struct {
	Path        string         `yaml:"path" json:"path"`
	Upstream    string         `yaml:"upstream" json:"upstream"`
	StripPath   bool           `yaml:"strip_path,omitempty" json:"strip_path,omitempty"`
	WebSocket   bool           `yaml:"websocket,omitempty" json:"websocket,omitempty"`
	Priority    int            `yaml:"priority,omitempty" json:"priority,omitempty"`
	PluginsJSON string         `yaml:"plugins_json,omitempty" json:"plugins_json,omitempty"`
	OriginTLS   *OriginTLSSpec `yaml:"origin_tls,omitempty" json:"origin_tls,omitempty"`
}

type OriginTLSSpec struct {
	Enabled    bool   `yaml:"enabled" json:"enabled"`
	VerifyCert bool   `yaml:"verify_cert" json:"verify_cert"`
	SNIHost    string `yaml:"sni_host,omitempty" json:"sni_host,omitempty"`
	CACert     string `yaml:"ca_cert,omitempty" json:"ca_cert,omitempty"`
	MTLS       bool   `yaml:"mtls" json:"mtls"`
	ClientCert string `yaml:"client_cert,omitempty" json:"client_cert,omitempty"`
	ClientKey  string `yaml:"client_key,omitempty" json:"client_key,omitempty"`
}

func (o *OriginTLSSpec) UnmarshalJSON(data []byte) error {
	type Alias OriginTLSSpec
	var aux struct {
		Alias
		VerifyCertCamel *bool   `json:"verifyCert"`
		SNIHostCamel    *string `json:"sniHost"`
		CACertCamel     *string `json:"caCert"`
		MTLSCamel       *bool   `json:"mTLS"`
		ClientCertCamel *string `json:"clientCert"`
		ClientKeyCamel  *string `json:"clientKey"`
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*o = OriginTLSSpec(aux.Alias)
	if aux.VerifyCertCamel != nil {
		o.VerifyCert = *aux.VerifyCertCamel
	}
	if aux.SNIHostCamel != nil {
		o.SNIHost = *aux.SNIHostCamel
	}
	if aux.CACertCamel != nil {
		o.CACert = *aux.CACertCamel
	}
	if aux.MTLSCamel != nil {
		o.MTLS = *aux.MTLSCamel
	}
	if aux.ClientCertCamel != nil {
		o.ClientCert = *aux.ClientCertCamel
	}
	if aux.ClientKeyCamel != nil {
		o.ClientKey = *aux.ClientKeyCamel
	}
	return nil
}

type CertificateSpec struct {
	ID          string   `yaml:"id" json:"id"`
	Name        string   `yaml:"name" json:"name"`
	SNIs        []string `yaml:"snis" json:"snis"`
	CertPEM     string   `yaml:"cert_pem" json:"cert_pem"`
	KeyPEM      string   `yaml:"key_pem" json:"key_pem"`
	MTLSEnabled bool     `yaml:"mtls_enabled" json:"mtls_enabled"`
	ClientCAPEM string   `yaml:"client_ca_pem,omitempty" json:"client_ca_pem,omitempty"`
	VerifyDepth int      `yaml:"verify_depth,omitempty" json:"verify_depth,omitempty"`
}

type L4Spec struct {
	Upstreams []L4UpstreamSpec `yaml:"upstreams,omitempty" json:"upstreams,omitempty"`
	Services  []L4ServiceSpec  `yaml:"services,omitempty" json:"services,omitempty"`
}

type L4UpstreamSpec struct {
	Name      string         `yaml:"name" json:"name"`
	Protocol  string         `yaml:"protocol" json:"protocol"`
	Algorithm string         `yaml:"algorithm" json:"algorithm"`
	Servers   []L4ServerSpec `yaml:"servers,omitempty" json:"servers,omitempty"`
}

type L4ServerSpec struct {
	Addr        string `yaml:"addr" json:"addr"`
	Weight      int    `yaml:"weight,omitempty" json:"weight,omitempty"`
	MaxFails    int    `yaml:"max_fails,omitempty" json:"max_fails,omitempty"`
	FailTimeout string `yaml:"fail_timeout,omitempty" json:"fail_timeout,omitempty"`
	Backup      bool   `yaml:"backup,omitempty" json:"backup,omitempty"`
}

type L4ServiceSpec struct {
	Name                string          `yaml:"name" json:"name"`
	Protocol            string          `yaml:"protocol" json:"protocol"`
	ListenPort          int             `yaml:"listen_port" json:"listen_port"`
	ForwardTargetType   string          `yaml:"forward_target_type,omitempty" json:"forward_target_type,omitempty"`
	Upstream            string          `yaml:"upstream,omitempty" json:"upstream,omitempty"`
	Endpoint            string          `yaml:"endpoint,omitempty" json:"endpoint,omitempty"`
	ACL                 []L4ACLRuleSpec `yaml:"acl,omitempty" json:"acl,omitempty"`
	ProxyTimeout        string          `yaml:"proxy_timeout,omitempty" json:"proxy_timeout,omitempty"`
	ProxyConnectTimeout string          `yaml:"proxy_connect_timeout,omitempty" json:"proxy_connect_timeout,omitempty"`
	Enabled             bool            `yaml:"enabled" json:"enabled"`
}

type L4ACLRuleSpec struct {
	CIDR     string `yaml:"cidr" json:"cidr"`
	Action   string `yaml:"action" json:"action"`
	Priority uint32 `yaml:"priority" json:"priority"`
}
