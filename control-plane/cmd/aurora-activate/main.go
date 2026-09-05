package main

import (
	"aurora-waf.local/control-plane/infra"
	"aurora-waf.local/control-plane/internal/activation"
	"bytes"
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type localNode struct{ nginx, prefix, config string }

func (n localNode) Check(ctx context.Context) error {
	cmd := exec.CommandContext(ctx, n.nginx, "-e", "stderr", "-p", n.prefix, "-c", n.config, "-t")
	cmd.Stderr = os.Stderr
	return cmd.Run()
}
func (n localNode) Reload(ctx context.Context) error {
	// Do not accumulate draining generations under continuous activation. The
	// operator may retry this same journaled release once old workers finish.
	main, err := exec.CommandContext(ctx, "systemctl", "--user", "show", "--property=MainPID", "--value", "aurora-waf-nginx.service").Output()
	if err != nil {
		return err
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(main)))
	if err != nil || pid <= 1 {
		return fmt.Errorf("NGINX master is not running")
	}
	children, err := os.ReadFile(fmt.Sprintf("/proc/%d/task/%d/children", pid, pid))
	if err != nil {
		return err
	}
	for _, child := range strings.Fields(string(children)) {
		id, err := strconv.Atoi(child)
		if err != nil || id <= 1 {
			return fmt.Errorf("invalid worker PID")
		}
		title, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", id))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		if bytes.Contains(title, []byte("worker process is shutting down")) {
			return fmt.Errorf("previous generation is draining; retry the same release")
		}
	}
	// Fixed unit, no command or shell fragment comes from an API request.
	return exec.CommandContext(ctx, "systemctl", "--user", "kill", "--kill-whom=main", "--signal=HUP", "aurora-waf-nginx.service").Run()
}
func main() {
	release := flag.Int64("release", 0, "ready release ID (older generations rejected)")
	database := flag.String("database", "control-plane/data/aurora.db", "SQLite file")
	policy := flag.String("policy", "build/runtime/active-policy.json", "configured NGINX snapshot")
	nginx := flag.String("nginx", "nginx", "trusted NGINX binary")
	prefix := flag.String("prefix", ".", "NGINX prefix")
	config := flag.String("config", "deploy/nginx/nginx.conf", "NGINX config")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := infra.OpenSQLite(ctx, *database)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	policyPath, err := filepath.Abs(*policy)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	prefixPath, err := filepath.Abs(*prefix)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	s := activation.Service{Repository: &activation.SQLiteRepository{DB: db}, Node: localNode{*nginx, prefixPath + "/", *config}, PolicyPath: policyPath}
	result, err := s.Activate(ctx, activation.Command{ReleaseID: *release})
	db.Close()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("release=%d phase=%s (not an all-workers applied acknowledgement)\n", result.ReleaseID, result.Phase)
}
