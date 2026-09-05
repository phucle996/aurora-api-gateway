// Package policyagent owns one node's policy activation transaction. It is not
// linked into the NGINX request path and does not reuse the reload workflow.
package policyagent

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Agent struct {
	// SyncKind selects an independent snapshot authority using the same local
	// durable activation protocol; policy payloads and access payloads never mix.
	SyncKind                                                               string
	Controller, NodeID, Token, NGINX, Config, Prefix, PolicyFile, ProbeURL string
	Client                                                                 *http.Client
}
type desired struct {
	ReleaseID int64           `json:"release_id"`
	Digest    string          `json:"digest"`
	Payload   json.RawMessage `json:"payload"`
}
type journal struct {
	ReleaseID int64  `json:"release_id"`
	Previous  []byte `json:"previous"`
}

// RecoverBeforeStart restores the last-good durable bytes before NGINX starts;
// startup recovery must not depend on an available controller or live worker.
func (a *Agent) RecoverBeforeStart() error {
	if !filepath.IsAbs(a.PolicyFile) {
		return errors.New("policy path must be absolute")
	}
	lock, err := os.OpenFile(a.PolicyFile+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	file, err := os.Open(a.PolicyFile + ".activation.json")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	b, err := io.ReadAll(io.LimitReader(file, 131073))
	if err != nil {
		return err
	}
	var j journal
	if len(b) > 131072 || json.Unmarshal(b, &j) != nil || len(j.Previous) == 0 || len(j.Previous) > 65536 || !json.Valid(j.Previous) {
		return errors.New("invalid recovery journal; operator recovery required")
	}
	if err = replace(a.PolicyFile, j.Previous); err != nil {
		return err
	}
	return os.Remove(a.PolicyFile + ".activation.json")
}

// Atomic replacement is private to activation: same filesystem, fsync contents,
// rename, fsync parent. Every durable boundary (including recovery) needs this
// exact contract; open-coded variants risk acknowledging non-durable state.
func replace(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".aurora-policy-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(name, path); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func (a *Agent) Step(ctx context.Context) error {
	if a.Client == nil {
		return errors.New("policy agent requires bounded HTTP client")
	}
	for _, p := range []string{a.Config, a.Prefix, a.PolicyFile, a.NGINX} {
		if !filepath.IsAbs(p) || strings.ContainsAny(p, "\"'\n\r;{}") {
			return errors.New("agent requires safe absolute local paths")
		}
	}
	u, err := url.Parse(a.Controller)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return errors.New("invalid controller URL")
	}
	if a.NodeID == "" || strings.ContainsAny(a.NodeID, "/?#\\") || strings.ContainsAny(a.Token, "\r\n") {
		return errors.New("invalid node identity or token")
	}
	// All snapshot owners changing this NGINX config serialize validation/reload.
	lock, err := os.OpenFile(a.Config+".activation.lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	endpointPath := "/api/v1/policy-sync/"
	switch a.SyncKind {
	case "", "policy":
	case "access":
		endpointPath = "/api/v1/access-sync/"
	default:
		return errors.New("unknown snapshot authority")
	}
	endpoint := strings.TrimRight(a.Controller, "/") + endpointPath + url.PathEscape(a.NodeID)
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.Token)
	resp, err := a.Client.Do(req)
	if err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 131073))
	resp.Body.Close()
	if err != nil {
		return err
	}
	if resp.StatusCode != 200 || len(data) > 131072 {
		return errors.New("policy desired-state unavailable")
	}
	var target desired
	if err = json.Unmarshal(data, &target); err != nil {
		return err
	}
	if target.ReleaseID == 0 {
		return nil
	}
	if target.ReleaseID < 1 || len(target.Payload) > 65536 || fmt.Sprintf("%x", sha256.Sum256(target.Payload)) != target.Digest {
		return errors.New("policy digest mismatch")
	}
	var envelope struct {
		Generation int64 `json:"generation"`
	}
	if json.Unmarshal(target.Payload, &envelope) != nil || envelope.Generation != target.ReleaseID {
		return errors.New("policy generation mismatch")
	}
	// This probe is operator-configured loopback, not a URL received from the API.
	probe, err := url.Parse(a.ProbeURL)
	if err != nil || probe.Scheme != "http" || (probe.Hostname() != "127.0.0.1" && probe.Hostname() != "::1") {
		return errors.New("generation probe must be loopback HTTP")
	}
	observe := func() bool {
		q, e := http.NewRequestWithContext(ctx, "GET", a.ProbeURL, nil)
		if e != nil {
			return false
		}
		q.Close = true
		r, e := a.Client.Do(q)
		if e != nil {
			return false
		}
		defer r.Body.Close()
		b, e := io.ReadAll(io.LimitReader(r.Body, 64))
		return e == nil && r.StatusCode == 200 && strings.TrimSpace(string(b)) == strconv.FormatInt(target.ReleaseID, 10)
	}
	report := func(phase, message string) error {
		if len(message) > 512 {
			message = message[:512]
		}
		b, _ := json.Marshal(map[string]any{"release_id": target.ReleaseID, "phase": phase, "message": message})
		q, e := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
		if e != nil {
			return e
		}
		q.Header.Set("Authorization", "Bearer "+a.Token)
		q.Header.Set("Content-Type", "application/json")
		r, e := a.Client.Do(q)
		if e != nil {
			return e
		}
		r.Body.Close()
		if r.StatusCode != 204 {
			return fmt.Errorf("policy report rejected: %d", r.StatusCode)
		}
		return nil
	}
	run := func(conf string, reload bool) error {
		args := []string{"-p", a.Prefix, "-c", conf}
		if reload {
			args = append(args, "-s", "reload")
		} else {
			args = append(args, "-t")
		}
		cmd := exec.CommandContext(ctx, a.NGINX, args...)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("nginx validation/reload failed: %w", err)
		}
		return nil
	}
	journalPath := a.PolicyFile + ".activation.json"
	if pending, e := os.ReadFile(journalPath); e == nil {
		var j journal
		if json.Unmarshal(pending, &j) != nil {
			return errors.New("invalid activation journal; operator recovery required")
		}
		if j.ReleaseID == target.ReleaseID && observe() {
			if err = report("observed", "generation observed on a fresh local connection; draining old workers may remain"); err != nil {
				return err
			}
			return os.Remove(journalPath)
		}
		if err = replace(a.PolicyFile, j.Previous); err != nil {
			return err
		}
		if err = run(a.Config, false); err != nil {
			return err
		}
		if err = run(a.Config, true); err != nil {
			return err
		}
		if err = report("failed", "interrupted activation rolled back; retry pending"); err != nil {
			return err
		}
		if err = os.Remove(journalPath); err != nil {
			return err
		}
	} else if !errors.Is(e, os.ErrNotExist) {
		return e
	}
	if observe() {
		return report("observed", "generation observed on a fresh local connection; draining old workers may remain")
	}
	previous, err := os.ReadFile(a.PolicyFile)
	if err != nil {
		return err
	}
	if len(previous) > 65536 {
		return errors.New("existing policy exceeds limit")
	}
	config, err := os.ReadFile(a.Config)
	if err != nil {
		return err
	}
	if !bytes.Contains(config, []byte(a.PolicyFile)) {
		return errors.New("live nginx config must reference the configured absolute policy path")
	}
	stage, err := os.CreateTemp(filepath.Dir(a.PolicyFile), ".aurora-candidate-*")
	if err != nil {
		return err
	}
	stagePath := stage.Name()
	stage.Close()
	defer os.Remove(stagePath)
	if err = replace(stagePath, target.Payload); err != nil {
		return err
	}
	candidate, err := os.CreateTemp(filepath.Dir(a.Config), ".aurora-nginx-*")
	if err != nil {
		return err
	}
	candidatePath := candidate.Name()
	candidate.Close()
	defer os.Remove(candidatePath)
	if err = replace(candidatePath, bytes.ReplaceAll(config, []byte(a.PolicyFile), []byte(stagePath))); err != nil {
		return err
	}
	if err = run(candidatePath, false); err != nil {
		_ = report("failed", "candidate nginx -t rejected; previous policy retained")
		return err
	}
	if err = report("validated", "candidate passed nginx -t"); err != nil {
		return err
	}
	j, _ := json.Marshal(journal{target.ReleaseID, previous})
	if err = replace(journalPath, j); err != nil {
		return err
	}
	if err = replace(a.PolicyFile, target.Payload); err != nil {
		return err
	}
	// Restore last-good bytes immediately on a live validation/reload failure,
	// even if control-plane connectivity disappears before the next tick.
	if err = run(a.Config, false); err != nil {
		if restoreErr := replace(a.PolicyFile, previous); restoreErr != nil {
			return errors.Join(err, restoreErr)
		}
		_ = report("failed", "live nginx -t rejected; recovery pending")
		return err
	}
	if err = run(a.Config, true); err != nil {
		if restoreErr := replace(a.PolicyFile, previous); restoreErr != nil {
			return errors.Join(err, restoreErr)
		}
		_ = report("failed", "reload command failed; recovery pending")
		return err
	}
	if err = report("reload_requested", "reload requested, waiting for generation observation"); err != nil {
		return err
	}
	for i := 0; i < 20; i++ {
		if observe() {
			if err = report("observed", "generation observed on a fresh local connection; draining old workers may remain"); err != nil {
				return err
			}
			return os.Remove(journalPath)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return errors.New("generation not observed; recovery journal retained")
}
