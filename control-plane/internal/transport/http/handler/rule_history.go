package handler

import (
	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/domain/taxonomy"
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func RuleHistory(s port.RuleService) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id < 1 {
			c.String(http.StatusBadRequest, "invalid rule ID")
			return
		}
		limit := 50
		var before int64
		if limitStr := c.Query("limit"); limitStr != "" {
			limit, err = strconv.Atoi(limitStr)
			if err != nil || limit < 1 || limit > 100 {
				c.String(http.StatusBadRequest, "invalid limit")
				return
			}
		}
		if beforeStr := c.Query("before"); beforeStr != "" {
			before, err = strconv.ParseInt(beforeStr, 10, 64)
			if err != nil || before < 0 {
				c.String(http.StatusBadRequest, "invalid cursor")
				return
			}
		}
		out, err := s.History(c.Request.Context(), entity.RuleHistoryQuery{ID: id, Before: before, Limit: limit})
		if err != nil {
			if errors.Is(err, taxonomy.ErrRuleNotFound) {
				c.String(http.StatusNotFound, err.Error())
				return
			}
			c.String(http.StatusInternalServerError, "rules operation failed")
			return
		}
		items := make([]gin.H, 0, len(out.Items))
		for _, item := range out.Items {
			items = append(items, gin.H{
				"version":    item.Version,
				"name":       item.Name,
				"action":     item.Action,
				"enabled":    item.Enabled,
				"actor":      item.Actor,
				"updated_at": item.UpdatedAt,
			})
		}
		resp := gin.H{
			"items": items,
		}
		if out.NextBefore != 0 {
			resp["next_before"] = out.NextBefore
		}
		c.JSON(http.StatusOK, resp)
	}
}
