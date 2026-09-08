package handler

import (
	"net/http/httptest"
	"strings"
	"testing"

	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

func TestDependencyInstallRequiresAdminBeforeDispatch(t *testing.T) {
	for _, role := range []string{"", "viewer", "operator"} {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set(middleware.CtxUserRoleKey, role)
		c.Request = httptest.NewRequest("POST", "/api/v1/settings/dependencies/node-01/jobs", strings.NewReader(`{"action":"install_brotli"}`))
		// Nil service proves unauthorized requests cannot dispatch a job.
		h := NewDependenciesHandler(nil, nil, nil, nil)
		h.Queue(c)
		if w.Code != 403 {
			t.Fatalf("role %q allowed install: %d", role, w.Code)
		}
	}
}
