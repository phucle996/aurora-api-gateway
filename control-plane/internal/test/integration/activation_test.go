package integration_test

import (
	"aurora-waf.local/control-plane/internal/activation"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type activationNodeFixture struct {
	checkErr, reloadErr error
	checks, reloads     int
}

func (n *activationNodeFixture) Check(context.Context) error  { n.checks++; return n.checkErr }
func (n *activationNodeFixture) Reload(context.Context) error { n.reloads++; return n.reloadErr }

func TestActivationJournalRecoveryAndInvalidRestore(t *testing.T) {
	db, _ := rulesFixture(t)
	ctx := context.Background()
	dir := t.TempDir()
	path := filepath.Join(dir, "active.json")
	old := []byte(`{"schema_version":1,"block_paths":["/guard"]}`)
	if err := os.WriteFile(path, old, 0600); err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{"schema_version":2,"generation":1,"rules":[]}`)
	sum := sha256.Sum256(payload)
	_, err := db.Exec("INSERT INTO ruleset_releases(id,request_key,payload,digest,state) VALUES(1,'activation-key-01',?,?,'ready')", payload, hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	node := &activationNodeFixture{checkErr: errors.New("invalid config")}
	s := activation.Service{Repository: &activation.SQLiteRepository{DB: db}, Node: node, PolicyPath: path}
	if _, err = s.Activate(ctx, activation.Command{ReleaseID: 1}); err == nil {
		t.Fatal("invalid check accepted")
	}
	disk, _ := os.ReadFile(path)
	if string(disk) != string(old) || node.reloads != 0 {
		t.Fatal("failed validation changed durable policy")
	}
	node.checkErr = nil
	node.reloadErr = errors.New("signal failed or acknowledgement lost")
	if _, err = s.Activate(ctx, activation.Command{ReleaseID: 1}); err == nil {
		t.Fatal("reload failure accepted")
	}
	var phase string
	if err = db.QueryRow("SELECT phase FROM node_activation").Scan(&phase); err != nil || phase != "pending" {
		t.Fatal(phase, err)
	}
	// A second job cannot supersede an unsettled generation.
	payload2 := []byte(`{"schema_version":2,"generation":2,"rules":[]}`)
	sum2 := sha256.Sum256(payload2)
	_, err = db.Exec("INSERT INTO ruleset_releases(id,request_key,payload,digest,state) VALUES(2,'activation-key-02',?,?,'ready')", payload2, hex.EncodeToString(sum2[:]))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Activate(ctx, activation.Command{ReleaseID: 2}); err == nil {
		t.Fatal("pending generation superseded")
	}
	node.reloadErr = nil
	result, err := s.Activate(ctx, activation.Command{ReleaseID: 1})
	if err != nil || result.Phase != "reload_requested" {
		t.Fatal(result, err)
	}
	reloads := node.reloads
	if _, err = s.Activate(ctx, activation.Command{ReleaseID: 1}); err != nil || node.reloads != reloads {
		t.Fatal("idempotent activation sent another reload", err)
	}
	// Simulates a torn journal/file boundary after a crash: durable intent drives repair.
	if err = os.WriteFile(path, old, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Activate(ctx, activation.Command{ReleaseID: 1}); err != nil || node.reloads != reloads+1 {
		t.Fatal("disk drift not reconciled", err)
	}
	if _, err = s.Activate(ctx, activation.Command{ReleaseID: 2}); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Activate(ctx, activation.Command{ReleaseID: 1}); err == nil {
		t.Fatal("stale activation accepted")
	}
}
