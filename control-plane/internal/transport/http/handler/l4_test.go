package handler_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"aurora-waf.local/control-plane/internal/domain/entity"
	"aurora-waf.local/control-plane/internal/repository"
	"aurora-waf.local/control-plane/internal/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"aurora-waf.local/control-plane/internal/transport/http/handler"
	"aurora-waf.local/control-plane/migrations"
	"github.com/gin-gonic/gin"
	_ "modernc.org/sqlite"
)

func setupL4TestRouter(t *testing.T) (*gin.Engine, *handler.L4Handler, *sql.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if _, err := db.Exec(migrations.Tables); err != nil {
		t.Fatalf("run tables migration: %v", err)
	}

	l4Repo := repository.NewL4Repository(db, db)
	upstreamRepo := repository.NewUpstreamRepository(db, db)
	l4Svc := service.NewL4Service(l4Repo)
	l4Hdr := handler.NewL4Handler(l4Svc, upstreamRepo)

	r := gin.New()
	r.GET("/api/v1/l4/services", l4Hdr.ListServices)
	r.POST("/api/v1/l4/services", l4Hdr.CreateService)
	r.GET("/api/v1/l4/services/:id", l4Hdr.GetService)
	r.PUT("/api/v1/l4/services/:id", l4Hdr.UpdateService)
	r.DELETE("/api/v1/l4/services/:id", l4Hdr.DeleteService)
	r.PATCH("/api/v1/l4/services/:id/status", l4Hdr.ToggleServiceStatus)

	return r, l4Hdr, db
}

func TestL4Handler_Validations(t *testing.T) {
	r, _, db := setupL4TestRouter(t)
	defer db.Close()

	upstreamRepo := repository.NewUpstreamRepository(db, db)
	ctx := context.Background()

	// Seed an upstream for target testing
	_, err := upstreamRepo.Create(ctx, entity.CreateUpstreamCommand{
		Name:             "redis_pool",
		ArchitectureType: "Load Balancer",
		Algorithm:        "round_robin",
		Servers: []entity.UpstreamNode{
			{Address: "127.0.0.1:6379", Weight: 1, Healthy: true},
		},
	}, "", "")
	if err != nil {
		t.Fatalf("seed upstream failed: %v", err)
	}

	// 1. Empty service name -> 400
	t.Run("Empty service name", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "   ",
			Protocol:          "tcp",
			ListenPort:        6379,
			ForwardTargetType: "upstream",
			UpstreamName:      "redis_pool",
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 2. Invalid port (< 1 or > 65535) -> 400
	t.Run("Invalid listen port", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "bad_port_svc",
			Protocol:          "tcp",
			ListenPort:        99999,
			ForwardTargetType: "upstream",
			UpstreamName:      "redis_pool",
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 3. Forward to non-existent upstream -> 400
	t.Run("Non-existent upstream", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "cache_svc",
			Protocol:          "tcp",
			ListenPort:        6379,
			ForwardTargetType: "upstream",
			UpstreamName:      "does_not_exist",
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 4. Invalid direct endpoint -> 400
	t.Run("Invalid direct endpoint", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "direct_db",
			Protocol:          "tcp",
			ListenPort:        5432,
			ForwardTargetType: "endpoint",
			DirectEndpoint:    "invalid-no-port",
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 5. Invalid ACL CIDR -> 400
	t.Run("Invalid ACL CIDR", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "acl_test",
			Protocol:          "tcp",
			ListenPort:        5432,
			ForwardTargetType: "upstream",
			UpstreamName:      "redis_pool",
			ACLRulesJSON:      `[{"cidr":"not-an-ip","action":"allow"}]`,
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Errorf("expected status 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 6. Valid service creation -> 201
	var createdID string
	t.Run("Valid service creation", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "redis_cache",
			Protocol:          "tcp",
			ListenPort:        6379,
			ForwardTargetType: "upstream",
			UpstreamName:      "redis_pool",
			ACLRulesJSON:      `[{"cidr":"10.0.0.0/8","action":"allow"},{"cidr":"0.0.0.0/0","action":"deny"}]`,
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
		}

		var resp dto.L4ServiceResponse
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("unmarshal response: %v", err)
		}
		createdID = resp.ID
	})

	// 7. Port collision on Create -> 409 Conflict
	t.Run("Port collision on create", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "duplicate_port_svc",
			Protocol:          "tcp",
			ListenPort:        6379,
			ForwardTargetType: "upstream",
			UpstreamName:      "redis_pool",
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Errorf("expected status 409, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 8. Create second service with direct endpoint -> 201
	var secondID string
	t.Run("Create direct endpoint service", func(t *testing.T) {
		body, _ := json.Marshal(dto.CreateL4ServiceRequest{
			Name:              "direct_db",
			Protocol:          "tcp",
			ListenPort:        5432,
			ForwardTargetType: "endpoint",
			DirectEndpoint:    "10.0.0.12:5432",
		})
		req, _ := http.NewRequest(http.MethodPost, "/api/v1/l4/services", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
		}
		var resp dto.L4ServiceResponse
		json.Unmarshal(w.Body.Bytes(), &resp)
		secondID = resp.ID
	})

	// 9. Port collision on Update (updating secondID to port 6379 which is taken by createdID) -> 409 Conflict
	t.Run("Port collision on update", func(t *testing.T) {
		body, _ := json.Marshal(dto.UpdateL4ServiceRequest{
			Name:              "direct_db",
			Protocol:          "tcp",
			ListenPort:        6379,
			ForwardTargetType: "endpoint",
			DirectEndpoint:    "10.0.0.12:5432",
		})
		req, _ := http.NewRequest(http.MethodPut, "/api/v1/l4/services/"+secondID, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Errorf("expected status 409, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 10. Update service keeping its own port -> 200 OK
	t.Run("Update service keeping port", func(t *testing.T) {
		body, _ := json.Marshal(dto.UpdateL4ServiceRequest{
			Name:              "redis_cache_renamed",
			Protocol:          "tcp",
			ListenPort:        6379,
			ForwardTargetType: "upstream",
			UpstreamName:      "redis_pool",
		})
		req, _ := http.NewRequest(http.MethodPut, "/api/v1/l4/services/"+createdID, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 11. Toggle service status -> 200 OK
	t.Run("Toggle service status", func(t *testing.T) {
		body, _ := json.Marshal(dto.ToggleL4ServiceStatusRequest{
			Enabled: false,
		})
		req, _ := http.NewRequest(http.MethodPatch, "/api/v1/l4/services/"+createdID+"/status", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 12. Delete service -> 200 OK
	t.Run("Delete service", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodDelete, "/api/v1/l4/services/"+createdID, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}
	})
}
