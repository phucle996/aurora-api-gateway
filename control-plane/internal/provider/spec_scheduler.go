package provider

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sync"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"github.com/goccy/go-yaml"
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
		} else if auth.AccessReleaseID > 0 {
			releaseID = auth.AccessReleaseID
		}
	}

	doc := Spec{
		Version:     1,
		ReleaseID:   releaseID,
		GeneratedAt: "2026-01-01T00:00:00Z",
		Extensions:  make(map[string]map[string]interface{}),
		WAF: WAFSpec{
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

		if len(auth.RoutingRecords) > 0 {
			domains := make([]DomainRoutingSpec, 0, len(auth.RoutingRecords))
			for _, d := range auth.RoutingRecords {
				if d.Host == "" {
					continue
				}
				path := d.Path
				if path == "" {
					path = "/"
				}
				domains = append(domains, DomainRoutingSpec{
					Host: d.Host,
					Locations: []LocationRoutingSpec{
						{
							Path:     path,
							Upstream: d.Target,
						},
					},
				})
			}
			if len(domains) > 0 {
				doc.Routing = RoutingSpec{Domains: domains}
			}
		}

		if len(auth.Extensions) > 0 {
			extensionsMap := make(map[string]map[string]interface{})
			for _, ext := range auth.Extensions {
				var cfg map[string]interface{}
				if err := json.Unmarshal([]byte(ext.ConfigJSON), &cfg); err == nil {
					cfg["enabled"] = ext.Enabled
					if cleaned, ok := cleanJSONFloats(cfg).(map[string]interface{}); ok {
						extensionsMap[ext.ID] = cleaned
					} else {
						extensionsMap[ext.ID] = cfg
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

// Spec represents the declarative specification for the Aurora gateway cluster.
type Spec struct {
	Version       uint32                            `yaml:"version" json:"version"`
	ReleaseID     int64                             `yaml:"release_id" json:"release_id"`
	GeneratedAt   string                            `yaml:"generated_at" json:"generated_at"`
	Extensions    map[string]map[string]interface{} `yaml:"extensions" json:"extensions"`
	WAF           WAFSpec                           `yaml:"waf" json:"waf"`
	Access        AccessSpec                        `yaml:"access" json:"access"`
	Upstreams     []UpstreamSpec                    `yaml:"upstreams,omitempty" json:"upstreams,omitempty"`
	UpstreamsConf string                            `yaml:"upstreams_conf,omitempty" json:"upstreams_conf,omitempty"`
	Routing       RoutingSpec                       `yaml:"routing,omitempty" json:"routing,omitempty"`
	RoutingConf   string                            `yaml:"routing_conf,omitempty" json:"routing_conf,omitempty"`
}

type ExtensionsSpec struct {
	Metrics *MetricsExtensionSpec `yaml:"metrics,omitempty" json:"metrics,omitempty"`
}

type MetricsExtensionSpec struct {
	Enabled       bool            `yaml:"enabled" json:"enabled"`
	Port          uint16          `yaml:"port" json:"port"`
	StubStatusURL string          `yaml:"stub_status_url,omitempty" json:"stub_status_url,omitempty"`
	Prometheus    *PrometheusSpec `yaml:"prometheus,omitempty" json:"prometheus,omitempty"`
	OTLP          *OTLPSpec       `yaml:"otlp,omitempty" json:"otlp,omitempty"`
}

type PrometheusSpec struct {
	Enabled bool   `yaml:"enabled" json:"enabled"`
	Path    string `yaml:"path" json:"path"`
}

type OTLPSpec struct {
	Enabled      bool   `yaml:"enabled" json:"enabled"`
	Endpoint     string `yaml:"endpoint" json:"endpoint"`
	IntervalSecs uint64 `yaml:"interval_secs" json:"interval_secs"`
}

type WAFSpec struct {
	Mode       string   `yaml:"mode" json:"mode"`
	BlockPaths []string `yaml:"block_paths,omitempty" json:"block_paths,omitempty"`
	RawJSON    string   `yaml:"raw_json,omitempty" json:"raw_json,omitempty"`
}

type AccessSpec struct {
	RawJSON string `yaml:"raw_json,omitempty" json:"raw_json,omitempty"`
}

type UpstreamSpec struct {
	Name    string               `yaml:"name" json:"name"`
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
	Path     string `yaml:"path" json:"path"`
	Upstream string `yaml:"upstream" json:"upstream"`
}
