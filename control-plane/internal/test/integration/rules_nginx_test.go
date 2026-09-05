package integration_test

import (
	"aurora-waf.local/control-plane/internal/activation"
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

type liveActivationNode struct {
	binary, config, dir string
	process             *os.Process
}

func (n liveActivationNode) Check(ctx context.Context) error {
	output, err := exec.CommandContext(ctx, n.binary, "-e", "stderr", "-p", n.dir+"/", "-c", n.config, "-t").CombinedOutput()
	if err != nil {
		return fmt.Errorf("nginx check: %s: %w", output, err)
	}
	return nil
}
func (n liveActivationNode) Reload(context.Context) error { return n.process.Signal(syscall.SIGHUP) }

func TestRulesPublishActivateDuringTraffic(t *testing.T) {
	nginx := os.Getenv("AURORA_TEST_NGINX")
	module := os.Getenv("AURORA_TEST_MODULE")
	compiler := os.Getenv("AURORA_TEST_COMPILER")
	if nginx == "" || module == "" || compiler == "" {
		t.Skip("requires real NGINX/module/compiler environment")
	}
	db, _ := rulesFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	dir := t.TempDir()
	policy := filepath.Join(dir, "policy.json")
	config := filepath.Join(dir, "nginx.conf")
	for _, name := range []string{"ok", "guard", "toggle"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	slowPayload := bytes.Repeat([]byte("x"), 64*1024)
	if err := os.WriteFile(filepath.Join(dir, "slow"), slowPayload, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(policy, []byte(`{"schema_version":1,"block_paths":["/guard","/toggle"]}`), 0600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	conf := fmt.Sprintf(`load_module %s;
worker_processes 2;
pid %s/nginx.pid;
error_log %s/error.log notice;
events { worker_connections 2048; }
http {
 access_log off;
 client_body_temp_path %s/client;
 proxy_temp_path %s/proxy;
 fastcgi_temp_path %s/fastcgi;
 uwsgi_temp_path %s/uwsgi;
 scgi_temp_path %s/scgi;
 server {
 listen 127.0.0.1:%d;
 root %s;
 aurora_waf on;
 aurora_waf_policy %s;
 add_header X-Aurora-Generation $aurora_waf_generation always;
 location / { try_files $uri =404; }
 location = /slow { limit_rate 16k; }
 }
}`, module, dir, dir, dir, dir, dir, dir, dir, port, dir, policy)
	if err = os.WriteFile(config, []byte(conf), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(nginx, "-e", "stderr", "-p", dir+"/", "-c", config, "-g", "daemon off;")
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	defer func() {
		command.Process.Signal(syscall.SIGQUIT)
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("nginx exit: %v %s", err, stderr.String())
			}
		case <-time.After(5 * time.Second):
			command.Process.Kill()
			<-done
			t.Error("nginx failed graceful shutdown")
		}
	}()
	transport := &http.Transport{DisableKeepAlives: true, MaxConnsPerHost: 32}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second}
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	for attempt := 0; ; attempt++ {
		response, e := client.Get(base + "/ok")
		if e == nil {
			io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.StatusCode == 200 {
				break
			}
		}
		if attempt >= 100 {
			t.Fatal("nginx startup", e)
		}
		time.Sleep(20 * time.Millisecond)
	}
	ruleSvc := service.NewRuleService(repository.NewRuleRepository(db, db), compiler)
	// Keep a real response on generation 0 alive across every publication. Its
	// worker must retain the old snapshot until this response drains completely.
	slowClient := &http.Client{Transport: transport, Timeout: 12 * time.Second}
	slow, err := slowClient.Get(base + "/slow")
	if err != nil {
		t.Fatal(err)
	}
	defer slow.Body.Close()
	if slow.StatusCode != 200 || slow.Header.Get("X-Aurora-Generation") != "0" {
		t.Fatal("unexpected initial slow generation")
	}
	firstByte := make([]byte, 1)
	if _, err = io.ReadFull(slow.Body, firstByte); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/guard", "/toggle"} {
		_, err = ruleSvc.Create(ctx, entity.CreateRuleCommand{RequestKey: "traffic-create-" + path, Name: path, Group: "custom", Action: "block", Severity: "high", Path: path, Enabled: true})
		if err != nil {
			t.Fatal(err)
		}
	}
	activator := activation.Service{Repository: &activation.SQLiteRepository{DB: db}, Node: liveActivationNode{nginx, config, dir, command.Process}, PolicyPath: policy}
	var expected sync.Map
	expected.Store(int64(0), 403)
	var requests atomic.Int64
	var stop atomic.Bool
	var wg sync.WaitGroup
	failures := make(chan error, 32)
	for worker := 0; worker < 20; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for !stop.Load() {
				for _, path := range []string{"/ok", "/guard", "/toggle"} {
					response, e := client.Get(base + path)
					if e != nil {
						failures <- e
						return
					}
					_, readErr := io.Copy(io.Discard, response.Body)
					response.Body.Close()
					if readErr != nil {
						failures <- readErr
						return
					}
					generation, e := strconv.ParseInt(response.Header.Get("X-Aurora-Generation"), 10, 64)
					want := 200
					if path == "/guard" {
						want = 403
					}
					if path == "/toggle" {
						value, ok := expected.Load(generation)
						if !ok {
							failures <- fmt.Errorf("unknown generation %d", generation)
							return
						}
						want = value.(int)
					}
					if e != nil || response.StatusCode != want {
						failures <- fmt.Errorf("%s generation=%d got=%d want=%d err=%v", path, generation, response.StatusCode, want, e)
						return
					}
					requests.Add(1)
				}
			}
		}()
	}
	defer func() {
		stop.Store(true)
		wg.Wait()
		close(failures)
		for failure := range failures {
			t.Error(failure)
		}
	}()
	for cycle := 1; cycle <= 6; cycle++ {
		enabled := cycle%2 == 1
		if cycle > 1 {
			_, err = ruleSvc.Update(ctx, entity.UpdateRuleCommand{ID: 2, ExpectedVersion: int64(cycle - 1), Name: "toggle", Group: "custom", Action: "block", Severity: "high", Path: "/toggle", Enabled: enabled})
			if err != nil {
				t.Fatal(err)
			}
		}
		release, e := ruleSvc.Publish(ctx, entity.PublishRulesCommand{RequestKey: fmt.Sprintf("traffic-publish-%04d", cycle)})
		if e != nil {
			t.Fatal(e)
		}
		want := 200
		if enabled {
			want = 403
		}
		expected.Store(release.ID, want)
		if _, e = activator.Activate(ctx, activation.Command{ReleaseID: release.ID}); e != nil {
			t.Fatal(e)
		}
		// Observe a real request on the new generation; not an all-workers barrier.
		for attempt := 0; ; attempt++ {
			response, e := client.Get(base + "/toggle")
			if e != nil {
				t.Fatal(e)
			}
			io.Copy(io.Discard, response.Body)
			response.Body.Close()
			if response.Header.Get("X-Aurora-Generation") == strconv.FormatInt(release.ID, 10) {
				if response.StatusCode != want {
					t.Fatal(response.StatusCode)
				}
				break
			}
			if attempt >= 100 {
				t.Fatal("new generation not observed")
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	remaining, err := io.ReadAll(slow.Body)
	if err != nil {
		t.Fatal("old generation response interrupted", err)
	}
	if !bytes.Equal(append(firstByte, remaining...), slowPayload) {
		t.Fatal("old response corrupted across reload")
	}
	log, err := os.ReadFile(filepath.Join(dir, "error.log"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(log), "signal 11") || strings.Contains(string(log), "exited with code 1") {
		t.Fatal(string(log))
	}
	if requests.Load() < 100 {
		t.Fatalf("insufficient traffic: %d", requests.Load())
	}
	t.Logf("%d requests, 20 clients, 2 workers, 6 immutable publications; generation-consistent decisions", requests.Load())
}
