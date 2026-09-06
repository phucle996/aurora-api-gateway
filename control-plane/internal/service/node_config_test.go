package service

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/domain/repo"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type configNodeRepository struct {
	repo.NodeRepository
	address string
}

func (r configNodeRepository) GetNodeByID(context.Context, string) (*entity.ClusterNodeRecord, error) {
	return &entity.ClusterNodeRecord{IP: r.address}, nil
}

func TestNodeConfigRedactsBeforeReturningAndRejectsRedirects(t *testing.T) {
	for _, mode := range []string{"plain", "quoted", "redirect", "oversized"} {
		t.Run(mode, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "redirect":
					http.Redirect(w, r, "http://127.0.0.1:1/secret", http.StatusFound)
				case "oversized":
					_, _ = w.Write([]byte(strings.Repeat("x", 1024*1024+1)))
				case "quoted":
					_, _ = w.Write([]byte("http { aurora_waf_token \"private;credential\"; }"))
				default:
					_, _ = w.Write([]byte("http { aurora_waf_token private-credential; }"))
				}
			}))
			defer upstream.Close()
			svc := NewNodeService(configNodeRepository{address: upstream.URL}, nil, nil)
			result, err := svc.GetNodeConfig(context.Background(), "node")
			if mode == "redirect" || mode == "oversized" {
				if err == nil {
					t.Fatal("unsafe config accepted")
				}
				return
			}
			if err != nil || strings.Contains(result, "private") || !strings.Contains(result, "[REDACTED]") {
				t.Fatal("config redaction failed", err)
			}
		})
	}
}
