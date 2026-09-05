package access

import (
	"aurora-waf.local/control-plane/internal/transport/http/middleware"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"strconv"
)

type Handler struct {
	ChangeService   ChangePort
	ReadService     ReadPort
	StatusService   StatusPort
	SyncService     SyncPort
	ReportService   ReportPort
	MatchService    MatchPort
	ActivityService ActivityPort
}

// Strict decoding and error redaction are local to the Access API boundary.
// Sharing these two guards prevents mutation/report paths from accepting extra
// authority fields or leaking storage errors.
func decode(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 65536)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if d.Decode(v) != nil || d.Decode(&struct{}{}) != io.EOF {
		c.JSON(400, gin.H{"message": "invalid access JSON"})
		return false
	}
	return true
}
func failure(c *gin.Context, e error) {
	status := 500
	message := "access storage unavailable"
	switch {
	case errors.Is(e, ErrInvalid):
		status = 422
		message = e.Error()
	case errors.Is(e, ErrConflict):
		status = 409
		message = e.Error()
	case errors.Is(e, ErrMissing):
		status = 404
		message = e.Error()
	case errors.Is(e, ErrCompiler):
		status = 503
		message = e.Error()
	}
	c.JSON(status, gin.H{"message": message})
}
func (h *Handler) Change(c *gin.Context) {
	var cmd ChangeCommand
	if !decode(c, &cmd) {
		return
	}
	cmd.Actor = c.GetString(middleware.CtxUsernameKey)
	cmd.Key = c.GetHeader("Idempotency-Key")
	out, e := h.ChangeService.Change(c.Request.Context(), cmd)
	if e != nil {
		failure(c, e)
		return
	}
	c.JSON(200, out)
}
func (h *Handler) Read(c *gin.Context) {
	q := ReadQuery{History: c.Query("history") == "true"}
	if id := c.Query("id"); id != "" {
		var e error
		q.ID, e = strconv.ParseInt(id, 10, 64)
		if e != nil || q.ID < 1 {
			failure(c, ErrInvalid)
			return
		}
	}
	if q.History && q.ID == 0 {
		failure(c, ErrInvalid)
		return
	}
	out, e := h.ReadService.Read(c.Request.Context(), q)
	if e != nil {
		failure(c, e)
		return
	}
	c.JSON(200, out)
}
func (h *Handler) Status(c *gin.Context) {
	out, e := h.StatusService.Status(c.Request.Context())
	if e != nil {
		failure(c, e)
		return
	}
	c.JSON(200, out)
}
func (h *Handler) Desired(c *gin.Context) {
	out, e := h.SyncService.Desired(c.Request.Context(), SyncQuery{c.Param("node")})
	if e != nil {
		failure(c, e)
		return
	}
	c.JSON(200, out)
}
func (h *Handler) Report(c *gin.Context) {
	var cmd ReportCommand
	if !decode(c, &cmd) {
		return
	}
	cmd.NodeID = c.Param("node")
	if e := h.ReportService.Report(c.Request.Context(), cmd); e != nil {
		failure(c, e)
		return
	}
	c.Status(204)
}
func (h *Handler) Match(c *gin.Context) {
	var cmd MatchCommand
	if !decode(c, &cmd) {
		return
	}
	cmd.NodeID = c.Param("node")
	if e := h.MatchService.Match(c.Request.Context(), cmd); e != nil {
		failure(c, e)
		return
	}
	c.Status(204)
}
func (h *Handler) Activity(c *gin.Context) {
	out, e := h.ActivityService.Activity(c.Request.Context())
	if e != nil {
		failure(c, e)
		return
	}
	c.JSON(200, out)
}
