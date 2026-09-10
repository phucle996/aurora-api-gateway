package dto

import "aurora-waf.local/control-plane/internal/domain/entity"

type CreateRouteRequest struct {
	Name         string `json:"name" binding:"required"`
	Host         string `json:"host" binding:"required"`
	Path         string `json:"path"`
	UpstreamName string `json:"upstream_name" binding:"required"`
	Enabled      *bool  `json:"enabled"`
	StripPath    bool   `json:"strip_path"`
	WebSocket    bool   `json:"websocket"`
	Priority     int    `json:"priority"`
	PluginsJSON  string `json:"plugins_json"`
	Description  string `json:"description"`
}

type UpdateRouteRequest struct {
	Name         string `json:"name" binding:"required"`
	Host         string `json:"host" binding:"required"`
	Path         string `json:"path"`
	UpstreamName string `json:"upstream_name" binding:"required"`
	Enabled      *bool  `json:"enabled"`
	StripPath    bool   `json:"strip_path"`
	WebSocket    bool   `json:"websocket"`
	Priority     int    `json:"priority"`
	PluginsJSON  string `json:"plugins_json"`
	Description  string `json:"description"`
}

type ToggleRouteStatusRequest struct {
	Enabled bool `json:"enabled"`
}

type RouteResponse struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Host         string `json:"host"`
	Path         string `json:"path"`
	UpstreamName string `json:"upstream_name"`
	Enabled      bool   `json:"enabled"`
	StripPath    bool   `json:"strip_path"`
	WebSocket    bool   `json:"websocket"`
	Priority     int    `json:"priority"`
	PluginsJSON  string `json:"plugins_json"`
	Description  string `json:"description"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

type ListRoutesResponse struct {
	Items []RouteResponse `json:"items"`
	Total int             `json:"total"`
}

func ToRouteResponse(item entity.RouteItem) RouteResponse {
	return RouteResponse{
		ID:           item.ID,
		Name:         item.Name,
		Host:         item.Host,
		Path:         item.Path,
		UpstreamName: item.UpstreamName,
		Enabled:      item.Enabled,
		StripPath:    item.StripPath,
		WebSocket:    item.WebSocket,
		Priority:     item.Priority,
		PluginsJSON:  item.PluginsJSON,
		Description:  item.Description,
		CreatedAt:    item.CreatedAt,
		UpdatedAt:    item.UpdatedAt,
	}
}
