package handler

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

const (
	policyQueryTimeout   = 5 * time.Second  // Dành cho List, Catalog, RuleCatalog, Cluster, Desired, Report
	policyDraftTimeout   = 10 * time.Second // Dành cho SaveDraft lưu bản nháp policy
	policyPublishTimeout = 15 * time.Second // Dành cho PublishDraft biên dịch và phát hành release
)

// PolicyHandler manages security policies and compiled policy releases.
type PolicyHandler struct {
	Service port.PolicyService
}

// NewPolicyHandler creates a new PolicyHandler instance.
func NewPolicyHandler(svc port.PolicyService) *PolicyHandler {
	return &PolicyHandler{
		Service: svc,
	}
}

func (h *PolicyHandler) List(c *gin.Context) {
	q := entity.ReadPoliciesQuery{}
	if c.Param("id") != "" {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid policy id"})
			return
		}
		q.ID = id
	}
	q.History = c.Query("history") == "true"

	ctx, cancel := context.WithTimeout(c.Request.Context(), policyQueryTimeout)
	defer cancel()

	out, err := h.Service.ReadPolicies(ctx, q)
	if err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy query timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}
	if q.ID > 0 && len(out) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"message": taxonomy.ErrPolicyNotFound.Error()})
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
	c.JSON(http.StatusOK, items)
}

// Catalog returns a lightweight policy list for UI dropdowns.
func (h *PolicyHandler) Catalog(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), policyQueryTimeout)
	defer cancel()

	out, err := h.Service.PolicyCatalog(ctx)
	if err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy catalog query timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}
	items := make([]dto.PolicyCatalogItemResponse, len(out))
	for i, it := range out {
		items[i] = dto.PolicyCatalogItemResponse{
			ID:   it.ID,
			Name: it.Name,
		}
	}
	c.JSON(http.StatusOK, items)
}

// RuleCatalog returns rule catalog items for policy rule assignment.
func (h *PolicyHandler) RuleCatalog(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), policyQueryTimeout)
	defer cancel()

	out, err := h.Service.PolicyRuleCatalog(ctx)
	if err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy rule catalog query timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
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
	c.JSON(http.StatusOK, items)
}

// Cluster returns the policy synchronization status across all cluster nodes.
func (h *PolicyHandler) Cluster(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), policyQueryTimeout)
	defer cancel()

	out, err := h.Service.PolicyCluster(ctx)
	if err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy cluster query timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
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
	c.JSON(http.StatusOK, dto.PolicyClusterStatusResponse{
		ReleaseID: out.ReleaseID,
		Nodes:     nodes,
	})
}

func (h *PolicyHandler) SaveDraft(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	var req dto.SavePolicyRequest
	if d.Decode(&req) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid JSON request"})
		return
	}
	var id int64
	if c.Param("id") != "" {
		var err error
		id, err = strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"message": "invalid policy id"})
			return
		}
	}
	actor := c.GetString(middleware.CtxUsernameKey)
	requestKey := c.GetHeader("Idempotency-Key")

	if id < 0 || req.ExpectedVersion < 0 || req.RestoreVersion < 0 || (id == 0 && (req.ExpectedVersion != 0 || req.RestoreVersion != 0)) || (id > 0 && req.ExpectedVersion == 0) || len(requestKey) < 8 || len(requestKey) > 128 || actor == "" {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
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
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
			return
		}
		if cmd.Host == "" || len(cmd.Host) > 253 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
			return
		}
		if cmd.Host != "*" {
			for _, label := range strings.Split(cmd.Host, ".") {
				if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
					c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
					return
				}
				for _, b := range []byte(label) {
					if !(b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || b == '-') {
						c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
						return
					}
				}
			}
		}
		if !strings.HasPrefix(cmd.PathPrefix, "/") || len(cmd.PathPrefix) > 8192 || strings.ContainsAny(cmd.PathPrefix, "%?#\\*") || strings.Contains(cmd.PathPrefix, "//") {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
			return
		}
		for _, b := range []byte(cmd.PathPrefix) {
			if b <= 32 || b >= 127 {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
				return
			}
		}
		for _, p := range strings.Split(cmd.PathPrefix, "/") {
			if p == "." || p == ".." {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
				return
			}
		}
		sort.Slice(cmd.RuleIDs, func(i, j int) bool { return cmd.RuleIDs[i] < cmd.RuleIDs[j] })
		for i, rid := range cmd.RuleIDs {
			if rid < 1 || (i > 0 && rid == cmd.RuleIDs[i-1]) {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
				return
			}
		}
		if cmd.RuleIDs == nil {
			cmd.RuleIDs = []int64{}
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), policyDraftTimeout)
	defer cancel()

	out, err := h.Service.Save(ctx, cmd)
	if err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy save draft timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}
	c.JSON(http.StatusOK, dto.SavePolicyResponse{
		ID:      out.ID,
		Version: out.Version,
	})
}

func (h *PolicyHandler) PublishDraft(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	var req dto.PublishPolicyRequest
	if d.Decode(&req) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid JSON request"})
		return
	}
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid policy id"})
		return
	}
	actor := c.GetString(middleware.CtxUsernameKey)
	requestKey := c.GetHeader("Idempotency-Key")
	preview := c.Query("preview") == "true"

	if id < 1 || req.ExpectedVersion < 1 || req.ExpectedRelease < 0 || actor == "" || (!preview && (len(requestKey) < 8 || len(requestKey) > 128)) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
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

	ctx, cancel := context.WithTimeout(c.Request.Context(), policyPublishTimeout)
	defer cancel()

	out, err := h.Service.Publish(ctx, cmd)
	if err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy publish timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}
	c.JSON(http.StatusOK, dto.PublishPolicyResponse{
		ReleaseID:  out.ReleaseID,
		Digest:     out.Digest,
		Payload:    out.Payload,
		Membership: out.Membership,
		Preview:    out.Preview,
	})
}

// Desired provides the active compiled policy release snapshot to worker nodes.
func (h *PolicyHandler) Desired(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), policyQueryTimeout)
	defer cancel()

	out, err := h.Service.PolicySync(ctx, entity.PolicySyncQuery{NodeID: c.Param("node")})
	if err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy desired sync timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}
	c.JSON(http.StatusOK, dto.PolicySyncResponse{
		ReleaseID: out.ReleaseID,
		Digest:    out.Digest,
		Payload:   out.Payload,
	})
}

func (h *PolicyHandler) Report(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	var req dto.PolicyReportRequest
	if d.Decode(&req) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid JSON request"})
		return
	}
	nodeID := c.Param("node")
	if nodeID == "" || req.ReleaseID < 1 || len(req.Message) > 512 || (req.Phase != "validated" && req.Phase != "reload_requested" && req.Phase != "observed" && req.Phase != "failed") {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrPolicyInvalid.Error()})
		return
	}
	cmd := entity.PolicyReportCommand{
		NodeID:    nodeID,
		ReleaseID: req.ReleaseID,
		Phase:     req.Phase,
		Message:   req.Message,
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), policyQueryTimeout)
	defer cancel()

	if err := h.Service.PolicyReport(ctx, cmd); err != nil {
		status := http.StatusInternalServerError
		message := "policy storage unavailable"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "policy report timed out"
		case errors.Is(err, taxonomy.ErrPolicyInvalid), errors.Is(err, taxonomy.ErrPolicyUnsupported):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPolicyNotFound):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrPublishUnavailable):
			status = http.StatusServiceUnavailable
			message = "runtime compiler unavailable or rejected snapshot"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}
	c.Status(http.StatusNoContent)
}
