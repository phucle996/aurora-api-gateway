package main

import (
	"aurora-waf.local/control-plane/internal/accessagent"
	"aurora-waf.local/control-plane/internal/policyagent"
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func main() {
	var a policyagent.Agent
	var tokenFile string
	var once bool
	var recoverOnly bool
	var matchLog string
	flag.StringVar(&a.SyncKind, "sync-kind", "policy", "snapshot authority: policy or access")
	flag.StringVar(&matchLog, "match-log", "", "NGINX access match log (access authority only)")
	flag.StringVar(&a.Controller, "controller", "http://127.0.0.1:8080", "controller URL")
	flag.StringVar(&a.NodeID, "node", "node-local-01", "registered node ID")
	flag.StringVar(&tokenFile, "token-file", "", "operator credential file")
	flag.StringVar(&a.NGINX, "nginx", "", "absolute NGINX executable")
	flag.StringVar(&a.Config, "config", "", "absolute live NGINX configuration")
	flag.StringVar(&a.Prefix, "prefix", "", "NGINX prefix")
	flag.StringVar(&a.PolicyFile, "policy", "", "absolute policy file referenced by live config")
	flag.StringVar(&a.ProbeURL, "probe", "", "loopback endpoint returning only $aurora_waf_generation")
	flag.BoolVar(&once, "once", false, "one reconciliation attempt")
	flag.BoolVar(&recoverOnly, "recover-only", false, "restore interrupted activation before starting nginx")
	flag.Parse()
	if recoverOnly {
		if err := a.RecoverBeforeStart(); err != nil {
			log.Fatal(err)
		}
		return
	}
	b, err := os.ReadFile(tokenFile)
	if err != nil {
		log.Fatal(err)
	}
	a.Token = strings.TrimSpace(string(b))
	if a.Token == "" {
		log.Fatal("empty credential")
	}
	a.Client = &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	for {
		err = a.Step(ctx)
		if once {
			if err != nil {
				log.Fatal(err)
			}
			return
		}
		if err != nil {
			log.Printf("policy reconciliation: %v", err)
		}
		if a.SyncKind == "access" && matchLog != "" {
			if e := (accessagent.Forwarder{Log: matchLog, Cursor: a.PolicyFile + ".matches.json", Controller: a.Controller, NodeID: a.NodeID, Token: a.Token, Client: a.Client}).Step(ctx); e != nil {
				log.Printf("access match delivery: %v", e)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
	}
}
