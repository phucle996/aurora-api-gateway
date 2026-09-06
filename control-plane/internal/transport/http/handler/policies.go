package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"strconv"
)

type PolicyHandler struct {
	Save    port.PolicySaveService
	Publish port.PolicyPublishService
	Read    port.PolicyReadService
	Sync    port.PolicySyncService
}

// Policy endpoint boundary only: strict bounded JSON and typed error redaction
// must be identical for mutation/replay safety; these are not global helpers.
func policyJSON(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(400, gin.H{"message": "invalid JSON request"})
		return false
	}
	return true
}
func policyError(c *gin.Context, err error) {
	status := 500
	message := "policy storage unavailable"
	switch {
	case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
		status = 422
		message = err.Error()
	case errors.Is(err, taxonomy.ErrPolicyConflict):
		status = 409
		message = err.Error()
	case errors.Is(err, taxonomy.ErrPolicyNotFound):
		status = 404
		message = err.Error()
	case errors.Is(err, taxonomy.ErrPublishUnavailable):
		status = 503
		message = "runtime compiler unavailable or rejected snapshot"
	}
	c.JSON(status, gin.H{"message": message})
}
func policyID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(400, gin.H{"message": "invalid policy id"})
		return 0, false
	}
	return id, true
}
func (h *PolicyHandler) List(c *gin.Context) {
	q := entity.ReadPoliciesQuery{}
	if c.Param("id") != "" {
		id, ok := policyID(c)
		if !ok {
			return
		}
		q.ID = id
	}
	q.History = c.Query("history") == "true"
	out, err := h.Read.ReadPolicies(c.Request.Context(), q)
	if err != nil {
		policyError(c, err)
		return
	}
	if q.ID > 0 && len(out) == 0 {
		policyError(c, taxonomy.ErrPolicyNotFound)
		return
	}
	c.JSON(200, out)
}
func (h *PolicyHandler) Catalog(c *gin.Context) {
	out, err := h.Read.PolicyCatalog(c.Request.Context())
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, out)
}
func (h *PolicyHandler) RuleCatalog(c *gin.Context) {
	out, err := h.Read.PolicyRuleCatalog(c.Request.Context())
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, out)
}
func (h *PolicyHandler) Cluster(c *gin.Context) {
	out, err := h.Read.PolicyCluster(c.Request.Context())
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, out)
}
func (h *PolicyHandler) SaveDraft(c *gin.Context) {
	var cmd entity.SavePolicyCommand
	if !policyJSON(c, &cmd) {
		return
	}
	if c.Param("id") != "" {
		id, ok := policyID(c)
		if !ok {
			return
		}
		cmd.ID = id
	}
	cmd.Actor = c.GetString(middleware.CtxUsernameKey)
	cmd.RequestKey = c.GetHeader("Idempotency-Key")
	out, err := h.Save.Save(c.Request.Context(), cmd)
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, out)
}
func (h *PolicyHandler) PublishDraft(c *gin.Context) {
	var cmd entity.PublishPolicyCommand
	if !policyJSON(c, &cmd) {
		return
	}
	id, ok := policyID(c)
	if !ok {
		return
	}
	cmd.ID = id
	cmd.Preview = c.Query("preview") == "true"
	cmd.Actor = c.GetString(middleware.CtxUsernameKey)
	cmd.RequestKey = c.GetHeader("Idempotency-Key")
	out, err := h.Publish.Publish(c.Request.Context(), cmd)
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, out)
}
func (h *PolicyHandler) Desired(c *gin.Context) {
	out, err := h.Sync.PolicySync(c.Request.Context(), entity.PolicySyncQuery{NodeID: c.Param("node")})
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, out)
}
func (h *PolicyHandler) Report(c *gin.Context) {
	var cmd entity.PolicyReportCommand
	if !policyJSON(c, &cmd) {
		return
	}
	cmd.NodeID = c.Param("node")
	if cmd.ReleaseID < 1 || len(cmd.Message) > 512 || (cmd.Phase != "validated" && cmd.Phase != "reload_requested" && cmd.Phase != "observed" && cmd.Phase != "failed") {
		policyError(c, taxonomy.ErrPolicyInvalid)
		return
	}
	if err := h.Sync.PolicyReport(c.Request.Context(), cmd); err != nil {
		policyError(c, err)
		return
	}
	c.Status(204)
}
