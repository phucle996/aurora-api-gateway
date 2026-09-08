package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	domainsvc "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"github.com/gin-gonic/gin"
)

const (
	accessChangeTimeout  = 10 * time.Second // Bao gồm thời gian biên dịch Rule/Group/Dataset qua Access Compiler
	accessQueryTimeout   = 5 * time.Second  // Dành cho các truy vấn dữ liệu từ SQLite (Read, Status, Catalog...)
	accessSyncTimeout    = 5 * time.Second  // Dành cho các node sync heartbeat/matches/report
)

// AccessHandler manages IP rules, network groups, datasets, and compiled release distributions.
type AccessHandler struct {
	Service domainsvc.AccessService
}

// NewAccessHandler creates a new AccessHandler instance.
func NewAccessHandler(svc domainsvc.AccessService) *AccessHandler {
	return &AccessHandler{
		Service: svc,
	}
}


// Change processes create, update, delete operations for access rules, groups, and datasets with OCC and compiler dispatch.
func (h *AccessHandler) Change(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields() // Nghiêm cấm các trường lạ ngoài schema để bảo vệ dữ liệu

	var req dto.AccessChangeRequest
	if d.Decode(&req) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid access JSON"})
		return
	}
	actor := c.GetString(middleware.CtxUsernameKey)
	key := c.GetHeader("Idempotency-Key")
	if actor == "" || len(key) < 8 || len(key) > 128 || req.ID < 0 || req.ExpectedVersion < 0 || req.ExpectedRelease < 0 ||
		(req.ID == 0 && (req.ExpectedVersion != 0 || req.Delete)) ||
		(req.ID > 0 && req.ExpectedVersion < 1) ||
		len(req.Document) > 65536 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
		return
	}
	switch req.Kind {
	case "rule", "group", "dataset":
	default:
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
		return
	}
	if !req.Delete {
		// Normalize and mask IP/CIDR prefix
		parseNetwork := func(raw string) (string, error) {
			p, e := netip.ParsePrefix(strings.TrimSpace(raw))
			if e != nil {
				a, ae := netip.ParseAddr(strings.TrimSpace(raw))
				if ae != nil || a.Zone() != "" {
					return "", taxonomy.ErrAccessInvalid
				}
				a = a.Unmap()
				p = netip.PrefixFrom(a, a.BitLen())
			}
			// Reject IPv4-in-IPv6 and scoped zones
			if p.Addr().Is4In6() || p.Addr().Zone() != "" {
				return "", taxonomy.ErrAccessInvalid
			}
			return p.Masked().String(), nil
		}

		switch req.Kind {
		case "rule":
			var doc dto.AccessRuleDocument
			dd := json.NewDecoder(bytes.NewReader(req.Document))
			dd.DisallowUnknownFields()
			if dd.Decode(&doc) != nil || dd.Decode(&struct{}{}) != io.EOF {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			doc.Host = strings.ToLower(strings.TrimSpace(doc.Host))
			if doc.Name == "" || len(doc.Name) > 120 || len(doc.Description) > 2000 || doc.Priority < 0 || doc.Priority > 1_000_000 ||
				doc.ExpiresAt < 0 || doc.ExpiresAt > 253402300799 || len(doc.Values) == 0 || len(doc.Values) > 1024 {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			if doc.Action != "allow" && doc.Action != "block" && doc.Action != "log" {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			if doc.Host == "" || len(doc.Host) > 253 {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			// Validate domain format (RFC-1123) or wildcard
			if doc.Host != "*" {
				for _, label := range strings.Split(doc.Host, ".") {
					if len(label) == 0 || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
						c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
						return
					}
					for _, b := range []byte(label) {
						if !(b >= 'a' && b <= 'z' || b >= '0' && b <= '9' || b == '-') {
							c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
							return
						}
					}
				}
			}
			// Validate path prefix
			if !strings.HasPrefix(doc.Path, "/") || len(doc.Path) > 8192 || strings.ContainsAny(doc.Path, "%?#\\*") || strings.Contains(doc.Path, "//") {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			for _, b := range []byte(doc.Path) {
				if b <= 32 || b >= 127 {
					c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
					return
				}
			}
			for _, p := range strings.Split(doc.Path, "/") {
				if p == ".." || p == "." {
					c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
					return
				}
			}
			// Validate HTTP method
			if !strings.Contains("|*|GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE|", "|"+doc.Method+"|") || doc.Method == "" {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			// Validate schedule window
			switch doc.Schedule {
			case "always", "business_hours", "weekend", "night":
			default:
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			// Normalize and validate source entries (CIDR, Country, ASN, Group ID)
			for i, value := range doc.Values {
				switch doc.Source {
				case "ip", "cidr":
					if doc.Source == "ip" {
						if _, e := netip.ParseAddr(value); e != nil {
							p, pe := netip.ParsePrefix(value)
							if pe != nil || p.Bits() != p.Addr().BitLen() {
								c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
								return
							}
						}
					}
					n, e := parseNetwork(value)
					if e != nil {
						c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
						return
					}
					doc.Values[i] = n
				case "country":
					value = strings.ToUpper(value)
					if len(value) != 2 || value[0] < 'A' || value[0] > 'Z' || value[1] < 'A' || value[1] > 'Z' {
						c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
						return
					}
					doc.Values[i] = value
				case "asn":
					n, e := strconv.ParseUint(strings.TrimPrefix(strings.ToUpper(value), "AS"), 10, 32)
					if e != nil || n == 0 {
						c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
						return
					}
					doc.Values[i] = fmt.Sprint(n)
				case "group":
					id, e := strconv.ParseInt(value, 10, 64)
					if e != nil || id < 1 {
						c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
						return
					}
					doc.Values[i] = fmt.Sprint(id)
				default:
					c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
					return
				}
			}
			req.Document, _ = json.Marshal(doc)

		case "group":
			var doc dto.AccessGroupDocument
			dd := json.NewDecoder(bytes.NewReader(req.Document))
			dd.DisallowUnknownFields()
			if dd.Decode(&doc) != nil || dd.Decode(&struct{}{}) != io.EOF {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			doc.Name = strings.TrimSpace(doc.Name)
			doc.Description = strings.TrimSpace(doc.Description)
			if len(doc.Description) > 255 {
				doc.Description = doc.Description[:255]
			}
			if doc.Name == "" || len(doc.Name) > 120 || len(doc.Networks) == 0 || len(doc.Networks) > 4096 {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			for i, n := range doc.Networks {
				value, e := parseNetwork(n)
				if e != nil {
					c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
					return
				}
				doc.Networks[i] = value
			}
			req.Document, _ = json.Marshal(doc)

		case "dataset":
			var doc dto.AccessDatasetDocument
			dd := json.NewDecoder(bytes.NewReader(req.Document))
			dd.DisallowUnknownFields()
			if dd.Decode(&doc) != nil || dd.Decode(&struct{}{}) != io.EOF {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			doc.Name = strings.TrimSpace(doc.Name)
			if doc.Name == "" || len(doc.Name) > 120 || len(doc.Networks) == 0 || len(doc.Networks) > 4096 {
				c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
				return
			}
			for i, n := range doc.Networks {
				value, e := parseNetwork(n.CIDR)
				if e != nil {
					c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
					return
				}
				n.CIDR = value
				n.Country = strings.ToUpper(strings.TrimSpace(n.Country))
				if n.Country != "" && (len(n.Country) != 2 || n.Country[0] < 'A' || n.Country[0] > 'Z' || n.Country[1] < 'A' || n.Country[1] > 'Z') {
					c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
					return
				}
				if n.ASN != "" {
					id, e := strconv.ParseUint(strings.TrimPrefix(strings.ToUpper(n.ASN), "AS"), 10, 32)
					if e != nil || id == 0 {
						c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
						return
					}
					n.ASN = fmt.Sprint(id)
				}
				doc.Networks[i] = n
			}
			req.Document, _ = json.Marshal(doc)
		}
	}

	cmd := entity.AccessChangeCommand{
		ID:              req.ID,
		Kind:            req.Kind,
		ExpectedVersion: req.ExpectedVersion,
		ExpectedRelease: req.ExpectedRelease,
		Delete:          req.Delete,
		Document:        req.Document,
		Actor:           actor,
		Key:             key,
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), accessChangeTimeout)
	defer cancel()

	out, err := h.Service.Change(ctx, cmd)
	if err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access change operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	c.JSON(http.StatusOK, dto.AccessChangeResponse{
		ID:        out.ID,
		Version:   out.Version,
		ReleaseID: out.ReleaseID,
	})
}


// Read returns current access configuration or version history.
func (h *AccessHandler) Read(c *gin.Context) {
	q := entity.AccessReadQuery{History: c.Query("history") == "true"}
	if id := c.Query("id"); id != "" {
		var err error
		q.ID, err = strconv.ParseInt(id, 10, 64)
		if err != nil || q.ID < 1 {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
			return
		}
	}
	if q.History && q.ID == 0 {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"message": taxonomy.ErrAccessInvalid.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), accessQueryTimeout)
	defer cancel()

	out, err := h.Service.Read(ctx, q)
	if err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access read operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	resp := make([]dto.AccessReadItemResponse, 0, len(out))
	for _, item := range out {
		resp = append(resp, dto.AccessReadItemResponse{
			ID:        item.ID,
			Kind:      item.Kind,
			Version:   item.Version,
			Document:  item.Document,
			Deleted:   item.Deleted,
			UpdatedAt: item.UpdatedAt,
			Actor:     item.Actor,
		})
	}
	c.JSON(http.StatusOK, resp)
}


// Status returns the active release ID and rollout status across nodes.
func (h *AccessHandler) Status(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), accessQueryTimeout)
	defer cancel()

	out, err := h.Service.Status(ctx)
	if err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access status operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	nodes := make([]dto.AccessStatusNodeResponse, 0, len(out.Nodes))
	for _, n := range out.Nodes {
		nodes = append(nodes, dto.AccessStatusNodeResponse{
			ID:        n.ID,
			ReleaseID: n.ReleaseID,
			Phase:     n.Phase,
			Message:   n.Message,
			UpdatedAt: n.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, dto.AccessStatusResponse{
		ReleaseID: out.ReleaseID,
		Nodes:     nodes,
	})
}


// Desired provides the compiled access configuration snapshot and digest to data plane nodes.
func (h *AccessHandler) Desired(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), accessSyncTimeout)
	defer cancel()

	out, err := h.Service.Desired(ctx, entity.AccessSyncQuery{NodeID: c.Param("node")})
	if err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access sync operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	c.JSON(http.StatusOK, dto.AccessSyncResponse{
		ReleaseID: out.ReleaseID,
		Digest:    out.Digest,
		Payload:   out.Payload,
	})
}


// Report receives node synchronization status for access control releases.
func (h *AccessHandler) Report(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()

	var req dto.AccessReportRequest
	if d.Decode(&req) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid access JSON"})
		return
	}

	cmd := entity.AccessReportCommand{
		NodeID:    c.Param("node"),
		ReleaseID: req.ReleaseID,
		Phase:     req.Phase,
		Message:   req.Message,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), accessSyncTimeout)
	defer cancel()

	if err := h.Service.Report(ctx, cmd); err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access report operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	c.Status(http.StatusNoContent)
}


// Match receives rule match telemetry events from edge nodes.
func (h *AccessHandler) Match(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()

	var req dto.AccessMatchRequest
	if d.Decode(&req) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid access JSON"})
		return
	}

	cmd := entity.AccessMatchCommand{
		NodeID:    c.Param("node"),
		Key:       req.Key,
		ReleaseID: req.ReleaseID,
		RuleID:    req.RuleID,
		IP:        req.IP,
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), accessSyncTimeout)
	defer cancel()

	if err := h.Service.Match(ctx, cmd); err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access match operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	c.Status(http.StatusNoContent)
}


// Activity returns recent access audit and match events.
func (h *AccessHandler) Activity(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), accessQueryTimeout)
	defer cancel()

	out, err := h.Service.Activity(ctx)
	if err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access activity operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	resp := make([]dto.AccessActivityItemResponse, 0, len(out))
	for _, item := range out {
		resp = append(resp, dto.AccessActivityItemResponse{
			RiskScore:  item.RiskScore,
			NodeID:     item.NodeID,
			RuleID:     item.RuleID,
			ReleaseID:  item.ReleaseID,
			IP:         item.IP,
			Action:     item.Action,
			Reputation: item.Reputation,
			Alert:      item.Alert,
			CreatedAt:  item.CreatedAt,
		})
	}
	c.JSON(http.StatusOK, resp)
}


// Catalog returns autocomplete metadata for hosts, countries, and ASNs.
func (h *AccessHandler) Catalog(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), accessQueryTimeout)
	defer cancel()

	out, err := h.Service.Catalog(ctx)
	if err != nil {
		status := http.StatusInternalServerError
		message := "access storage unavailable"
		switch {
		case errors.Is(err, taxonomy.ErrAccessInvalid):
			status = http.StatusUnprocessableEntity
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessConflict):
			status = http.StatusConflict
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessMissing):
			status = http.StatusNotFound
			message = err.Error()
		case errors.Is(err, taxonomy.ErrAccessCompiler):
			status = http.StatusServiceUnavailable
			message = err.Error()
		case errors.Is(err, context.DeadlineExceeded):
			status = http.StatusGatewayTimeout
			message = "access catalog operation timed out"
		}
		c.JSON(status, gin.H{"message": message})
		return
	}

	countries := make([]dto.AccessCatalogCountryResponse, 0, len(out.Countries))
	for _, country := range out.Countries {
		countries = append(countries, dto.AccessCatalogCountryResponse{
			Code:      country.Code,
			CIDRCount: country.CIDRCount,
		})
	}

	asns := make([]dto.AccessCatalogASNResponse, 0, len(out.ASNs))
	for _, asn := range out.ASNs {
		asns = append(asns, dto.AccessCatalogASNResponse{
			ASN:       asn.ASN,
			CIDRCount: asn.CIDRCount,
		})
	}

	c.JSON(http.StatusOK, dto.AccessCatalogResponse{
		Hosts:     out.Hosts,
		Countries: countries,
		ASNs:      asns,
	})
}
