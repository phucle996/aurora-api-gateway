package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
)

func CreateRuleDefinition(s port.CreateRuleDefinitionService) gin.HandlerFunc {
	return func(c *gin.Context) {
		media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if err != nil || media != "application/json" {
			c.String(http.StatusUnsupportedMediaType, "application/json required")
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 65536))
		if err != nil {
			c.String(http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		if !utf8.Valid(body) || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
			c.String(http.StatusBadRequest, "JSON object required")
			return
		}
		var cmd entity.CreateRuleDefinitionCommand
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&cmd); err != nil {
			c.String(http.StatusBadRequest, "invalid JSON or unknown field")
			return
		}
		if err = decoder.Decode(new(any)); err != io.EOF {
			c.String(http.StatusBadRequest, "trailing JSON")
			return
		}
		cmd.RequestKey = c.GetHeader("Idempotency-Key")
		out, err := s.CreateDefinition(c.Request.Context(), cmd)
		if err != nil {
			var invalid *entity.CreateRuleFieldError
			if errors.As(err, &invalid) {
				c.JSON(http.StatusUnprocessableEntity, gin.H{
					"code":   "invalid_rule_definition",
					"fields": invalid.Fields,
				})
				return
			}
			if errors.Is(err, entity.ErrRuleConflict) {
				c.String(http.StatusConflict, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		c.Header("Location", "/api/v1/rules/"+strconv.FormatInt(out.ID, 10))
		c.JSON(http.StatusCreated, out)
	}
}
