package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

type PolicyHandler struct {
	Service port.PolicyService
}

func NewPolicyHandler(svc port.PolicyService) *PolicyHandler {
	return &PolicyHandler{
		Service: svc,
	}
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
	out, err := h.Service.ReadPolicies(c.Request.Context(), q)
	if err != nil {
		policyError(c, err)
		return
	}
	if q.ID > 0 && len(out) == 0 {
		policyError(c, taxonomy.ErrPolicyNotFound)
		return
	}
	items := make([]dto.ReadPolicyItemResponse, len(out))
	for i, it := range out {
		items[i] = dto.ReadPolicyItemResponse{
			Status:           it.Status,
			ID:               it.ID,
			Version:          it.Version,
			PublishedVersion: it.PublishedVersion,
			Document:         it.Document,
			CreatedAt:        it.CreatedAt,
			UpdatedAt:        it.UpdatedAt,
			Actor:            it.Actor,
			Operation:        it.Operation,
		}
	}
	c.JSON(200, items)
}
func (h *PolicyHandler) Catalog(c *gin.Context) {
	out, err := h.Service.PolicyCatalog(c.Request.Context())
	if err != nil {
		policyError(c, err)
		return
	}
	items := make([]dto.PolicyCatalogItemResponse, len(out))
	for i, it := range out {
		items[i] = dto.PolicyCatalogItemResponse{
			ID:   it.ID,
			Name: it.Name,
		}
	}
	c.JSON(200, items)
}
func (h *PolicyHandler) RuleCatalog(c *gin.Context) {
	out, err := h.Service.PolicyRuleCatalog(c.Request.Context())
	if err != nil {
		policyError(c, err)
		return
	}
	items := make([]dto.PolicyCatalogRuleResponse, len(out))
	for i, it := range out {
		items[i] = dto.PolicyCatalogRuleResponse{
			ID:           it.ID,
			Version:      it.Version,
			Name:         it.Name,
			Group:        it.Group,
			Action:       it.Action,
			Enabled:      it.Enabled,
			RuntimeReady: it.RuntimeReady,
		}
	}
	c.JSON(200, items)
}
func (h *PolicyHandler) Cluster(c *gin.Context) {
	out, err := h.Service.PolicyCluster(c.Request.Context())
	if err != nil {
		policyError(c, err)
		return
	}
	nodes := make([]dto.PolicyClusterNodeResponse, len(out.Nodes))
	for i, n := range out.Nodes {
		nodes[i] = dto.PolicyClusterNodeResponse{
			ID:        n.ID,
			ReleaseID: n.ReleaseID,
			Phase:     n.Phase,
			Message:   n.Message,
			UpdatedAt: n.UpdatedAt,
		}
	}
	c.JSON(200, dto.PolicyClusterStatusResponse{
		ReleaseID: out.ReleaseID,
		Nodes:     nodes,
	})
}
func (h *PolicyHandler) SaveDraft(c *gin.Context) {
	var req dto.SavePolicyRequest
	if !policyJSON(c, &req) {
		return
	}
	var id int64
	if c.Param("id") != "" {
		var ok bool
		id, ok = policyID(c)
		if !ok {
			return
		}
	}
	actor := c.GetString(middleware.CtxUsernameKey)
	requestKey := c.GetHeader("Idempotency-Key")

	if id < 0 || req.ExpectedVersion < 0 || req.RestoreVersion < 0 || (id == 0 && (req.ExpectedVersion != 0 || req.RestoreVersion != 0)) || (id > 0 && req.ExpectedVersion == 0) || len(requestKey) < 8 || len(requestKey) > 128 || actor == "" {
		policyError(c, taxonomy.ErrPolicyInvalid)
		return
	}
	cmd := entity.SavePolicyCommand{
		ID:              id,
		ExpectedVersion: req.ExpectedVersion,
		RestoreVersion:  req.RestoreVersion,
		Name:            req.Name,
		Description:     req.Description,
		Host:            req.Host,
		PathPrefix:      req.PathPrefix,
		Mode:            req.Mode,
		Priority:        req.Priority,
		RuleIDs:         req.RuleIDs,
		Actor:           actor,
		RequestKey:      requestKey,
	}
	if cmd.RestoreVersion == 0 {
		cmd.Name = strings.TrimSpace(cmd.Name)
		cmd.Host = strings.ToLower(strings.TrimSpace(cmd.Host))
		cmd.PathPrefix = strings.TrimSpace(cmd.PathPrefix)
		if cmd.PathPrefix == "" {
			cmd.PathPrefix = "/"
		}
		if cmd.Name == "" || len(cmd.Name) > 120 || len(cmd.Description) > 2000 || !utf8.ValidString(cmd.Name+cmd.Description) || cmd.Priority < 0 || cmd.Priority > 1000000 || len(cmd.RuleIDs) > 1024 || (cmd.Mode != "mixed" && cmd.Mode != "block" && cmd.Mode != "detect") {
			policyError(c, taxonomy.ErrPolicyInvalid)
			return
		}
		if cmd.Host == "" || len(cmd.Host) > 253 {
			policyError(c, taxonomy.ErrPolicyInvalid)
			return
		}
		if cmd.Host != "*" {
			for _, label := range strings.Split(cmd.Host, ".") {
				if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
					policyError(c, taxonomy.ErrPolicyInvalid)
					return
				}
				for _, b := range []byte(label) {
					if !(b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || b == '-') {
						policyError(c, taxonomy.ErrPolicyInvalid)
						return
					}
				}
			}
		}
		if !strings.HasPrefix(cmd.PathPrefix, "/") || len(cmd.PathPrefix) > 8192 || strings.ContainsAny(cmd.PathPrefix, "%?#\\*") || strings.Contains(cmd.PathPrefix, "//") {
			policyError(c, taxonomy.ErrPolicyInvalid)
			return
		}
		for _, b := range []byte(cmd.PathPrefix) {
			if b <= 32 || b >= 127 {
				policyError(c, taxonomy.ErrPolicyInvalid)
				return
			}
		}
		for _, p := range strings.Split(cmd.PathPrefix, "/") {
			if p == "." || p == ".." {
				policyError(c, taxonomy.ErrPolicyInvalid)
				return
			}
		}
		sort.Slice(cmd.RuleIDs, func(i, j int) bool { return cmd.RuleIDs[i] < cmd.RuleIDs[j] })
		for i, rid := range cmd.RuleIDs {
			if rid < 1 || (i > 0 && rid == cmd.RuleIDs[i-1]) {
				policyError(c, taxonomy.ErrPolicyInvalid)
				return
			}
		}
		if cmd.RuleIDs == nil {
			cmd.RuleIDs = []int64{}
		}
	}

	out, err := h.Service.Save(c.Request.Context(), cmd)
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, dto.SavePolicyResponse{
		ID:      out.ID,
		Version: out.Version,
	})
}
func (h *PolicyHandler) PublishDraft(c *gin.Context) {
	var req dto.PublishPolicyRequest
	if !policyJSON(c, &req) {
		return
	}
	id, ok := policyID(c)
	if !ok {
		return
	}
	actor := c.GetString(middleware.CtxUsernameKey)
	requestKey := c.GetHeader("Idempotency-Key")
	preview := c.Query("preview") == "true"

	if id < 1 || req.ExpectedVersion < 1 || req.ExpectedRelease < 0 || actor == "" || (!preview && (len(requestKey) < 8 || len(requestKey) > 128)) {
		policyError(c, taxonomy.ErrPolicyInvalid)
		return
	}

	cmd := entity.PublishPolicyCommand{
		ID:              id,
		ExpectedVersion: req.ExpectedVersion,
		ExpectedRelease: req.ExpectedRelease,
		Disable:         req.Disable,
		Preview:         preview,
		Actor:           actor,
		RequestKey:      requestKey,
	}

	out, err := h.Service.Publish(c.Request.Context(), cmd)
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, dto.PublishPolicyResponse{
		ReleaseID:  out.ReleaseID,
		Digest:     out.Digest,
		Payload:    out.Payload,
		Membership: out.Membership,
		Preview:    out.Preview,
	})
}
func (h *PolicyHandler) Desired(c *gin.Context) {
	out, err := h.Service.PolicySync(c.Request.Context(), entity.PolicySyncQuery{NodeID: c.Param("node")})
	if err != nil {
		policyError(c, err)
		return
	}
	c.JSON(200, dto.PolicySyncResponse{
		ReleaseID: out.ReleaseID,
		Digest:    out.Digest,
		Payload:   out.Payload,
	})
}
func (h *PolicyHandler) Report(c *gin.Context) {
	var req dto.PolicyReportRequest
	if !policyJSON(c, &req) {
		return
	}
	nodeID := c.Param("node")
	if nodeID == "" || req.ReleaseID < 1 || len(req.Message) > 512 || (req.Phase != "validated" && req.Phase != "reload_requested" && req.Phase != "observed" && req.Phase != "failed") {
		policyError(c, taxonomy.ErrPolicyInvalid)
		return
	}
	cmd := entity.PolicyReportCommand{
		NodeID:    nodeID,
		ReleaseID: req.ReleaseID,
		Phase:     req.Phase,
		Message:   req.Message,
	}
	if err := h.Service.PolicyReport(c.Request.Context(), cmd); err != nil {
		policyError(c, err)
		return
	}
	c.Status(204)
}

