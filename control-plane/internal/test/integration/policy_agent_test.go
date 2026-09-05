package integration_test

import (
	"aurora-waf.local/control-plane/internal/policyagent"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestPolicyClusterRealNGINXAgents(t *testing.T) {
	nginx, module := os.Getenv("AURORA_TEST_NGINX"), os.Getenv("AURORA_TEST_MODULE")
	if nginx == "" || module == "" || os.Getenv("AURORA_TEST_COMPILER") == "" {
		t.Skip("requires real NGINX, module and compiler")
	}
	db, router := policyFixture(t)
	server := httptest.NewServer(router)
	defer server.Close()
	if _, err := db.Exec(`INSERT INTO cluster_nodes(id,name,hostname,ip,role,status,version,sync_status,join_method,certificate) VALUES('node-second','second','localhost','127.0.0.1','Edge Node','Ready','test','In Sync','fixture','none')`); err != nil {
		t.Fatal(err)
	}
	client := &http.Client{Timeout: 3 * time.Second}
	mutate := func(method, path, key, body string) []byte {
		t.Helper()
		q, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		q.Header.Set("Authorization", "Bearer policy-test-token")
		q.Header.Set("Idempotency-Key", key)
		q.Header.Set("Content-Type", "application/json")
		r, err := client.Do(q)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		if r.StatusCode != 200 {
			t.Fatalf("%s %d %s", path, r.StatusCode, b)
		}
		return b
	}
	agents := []*policyagent.Agent{}
	urls := []string{}
	for _, id := range []string{"node-local-01", "node-second"} {
		dir := t.TempDir()
		policyPath := filepath.Join(dir, "active.json")
		confPath := filepath.Join(dir, "nginx.conf")
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := l.Addr().(*net.TCPAddr).Port
		l.Close()
		probeListener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		probePort := probeListener.Addr().(*net.TCPAddr).Port
		probeListener.Close()
		if err = os.WriteFile(policyPath, []byte(`{"schema_version":1,"block_paths":[]}`), 0600); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, "private"), []byte("ok"), 0644); err != nil {
			t.Fatal(err)
		}
		conf := fmt.Sprintf(`load_module %s; worker_processes 2; pid %s/nginx.pid; error_log %s/error.log notice;
events { worker_connections 1024; }
http { access_log off; client_body_temp_path %s/client; proxy_temp_path %s/proxy; fastcgi_temp_path %s/fastcgi; uwsgi_temp_path %s/uwsgi; scgi_temp_path %s/scgi;
server { listen 127.0.0.1:%d; root %s; aurora_waf on; aurora_waf_policy %s;
location / { try_files $uri =404; } }
server { listen 127.0.0.1:%d; aurora_waf on; aurora_waf_policy %s;
location = /generation { return 200 "$aurora_waf_generation"; } }}
`, module, dir, dir, dir, dir, dir, dir, dir, port, dir, policyPath, probePort, policyPath)
		if err = os.WriteFile(confPath, []byte(conf), 0600); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(nginx, "-p", dir+"/", "-c", confPath, "-g", "daemon off;")
		logFile, err := os.Create(filepath.Join(dir, "process.log"))
		if err != nil {
			t.Fatal(err)
		}
		cmd.Stdout = logFile
		cmd.Stderr = logFile
		if err = cmd.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		t.Cleanup(func() {
			_ = cmd.Process.Signal(syscall.SIGQUIT)
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				_ = cmd.Process.Kill()
				<-done
			}
			logFile.Close()
		})
		base := fmt.Sprintf("http://127.0.0.1:%d", port)
		probeURL := fmt.Sprintf("http://127.0.0.1:%d/generation", probePort)
		urls = append(urls, base)
		ready := false
		for i := 0; i < 50; i++ {
			r, e := client.Get(probeURL)
			if e == nil {
				r.Body.Close()
				if r.StatusCode == 200 {
					ready = true
					break
				}
			}
			time.Sleep(20 * time.Millisecond)
		}
		if !ready {
			t.Fatal("NGINX did not start")
		}
		agents = append(agents, &policyagent.Agent{Controller: server.URL, NodeID: id, Token: "policy-test-token", NGINX: nginx, Config: confPath, Prefix: dir + "/", PolicyFile: policyPath, ProbeURL: probeURL, Client: client})
	}
	mutate("POST", "/api/v1/policies", "create-agent-1", `{"name":"App","host":"app.test","path_prefix":"/","mode":"mixed","priority":1,"rule_ids":[1],"expected_version":0}`)
	b := mutate("POST", "/api/v1/policies/1/publish", "publish-agent-1", `{"expected_version":1,"expected_release":0}`)
	var release struct {
		ReleaseID int64 `json:"release_id"`
	}
	if err := json.Unmarshal(b, &release); err != nil {
		t.Fatal(err)
	}
	// A missed observation leaves reload_requested durable. Reconciliation must
	// roll back and retry without getting stuck on a regressive phase report.
	probeURL := agents[0].ProbeURL
	agents[0].ProbeURL = strings.TrimSuffix(probeURL, "/generation") + "/unavailable"
	if err := agents[0].Step(context.Background()); err == nil {
		t.Fatal("activation acknowledged without a generation observation")
	}
	if err := agents[0].Step(context.Background()); err == nil || strings.Contains(err.Error(), "report rejected") {
		t.Fatal("retry did not reach generation observation", err)
	}
	agents[0].ProbeURL = probeURL
	for _, a := range agents {
		if err := a.Step(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	for _, base := range urls {
		for _, host := range []string{"app.test", "other.test"} {
			q, _ := http.NewRequest("GET", base+"/private", nil)
			q.Host = host
			q.Close = true
			r, err := client.Do(q)
			if err != nil {
				t.Fatal(err)
			}
			r.Body.Close()
			want := 200
			if host == "app.test" {
				want = 403
			}
			if r.StatusCode != want {
				t.Fatalf("%s %s: %d", base, host, r.StatusCode)
			}
		}
	}
	var observed int
	if err := db.QueryRow(`SELECT count(*) FROM policy_node_reports WHERE phase='observed'`).Scan(&observed); err != nil || observed != 2 {
		t.Fatal(observed, err)
	}
	// Publish disable, then corrupt one node's config. NGINX validation must fail
	// without replacing its active policy or stopping its currently running worker.
	mutate("POST", "/api/v1/policies/1/publish", "disable-agent-1", fmt.Sprintf(`{"expected_version":1,"expected_release":%d,"disable":true}`, release.ReleaseID))
	a := agents[0]
	old, _ := os.ReadFile(a.PolicyFile)
	conf, _ := os.ReadFile(a.Config)
	if err := os.WriteFile(a.Config, append(conf, []byte("\ninvalid_directive;\n")...), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.Step(context.Background()); err == nil {
		t.Fatal("invalid nginx config activated")
	}
	after, _ := os.ReadFile(a.PolicyFile)
	if !bytes.Equal(old, after) {
		t.Fatal("failed validation replaced active snapshot")
	}
	if err := os.WriteFile(a.Config, conf, 0600); err != nil {
		t.Fatal(err)
	}
	for _, a := range agents {
		if err := a.Step(context.Background()); err != nil {
			t.Fatal(err)
		}
		if err := a.Step(context.Background()); err != nil {
			t.Fatal("replay failed", err)
		}
	}
	for _, base := range urls {
		q, _ := http.NewRequest("GET", base+"/private", nil)
		q.Host = "app.test"
		q.Close = true
		r, err := client.Do(q)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != 200 {
			t.Fatal("disable not applied", r.StatusCode)
		}
	}
}
