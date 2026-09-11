package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"aurora-waf.local/control-plane/internal/domain/entity"
	port "aurora-waf.local/control-plane/internal/domain/service"
	"aurora-waf.local/control-plane/internal/transport/http/dto"
	"github.com/gin-gonic/gin"
)

const (
	nodeQueryTimeout     = 5 * time.Second
	nodeHeartbeatTimeout = 5 * time.Second
	nodeReloadTimeout    = 15 * time.Second
)

type NodeHandler struct {
	service port.NodeService
}

func NewNodeHandler(s port.NodeService) *NodeHandler {
	return &NodeHandler{service: s}
}

// List returns all registered data plane nodes and their runtime status.
func (h *NodeHandler) List(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	nodes, err := h.service.ListNodes(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "node list query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list nodes: " + err.Error()})
		return
	}

	response := make([]gin.H, 0, len(nodes))
	for i := range nodes {
		node := &nodes[i]
		response = append(response, gin.H{
			"id":                     node.ID,
			"name":                   node.Name,
			"hostname":               node.Hostname,
			"ip":                     node.IP,
			"status":                 node.Status,
			"version":                node.Version,
			"active_release_id":      node.ActiveReleaseID,
			"ruleset":                node.Ruleset,
			"sync":                   node.SyncStatus,
			"lastHeartbeat":          node.LastHeartbeat,
			"lastHeartbeatTimestamp": node.LastHeartbeatTimestamp,
			"created_at":             node.CreatedAt,
			"joinMethod":             node.JoinMethod,
			"certificate":            node.Certificate,
			"policySync":             node.PolicySync,
			"lastSyncTime":           node.LastSyncTime,
			"uptime":                 node.Uptime,
			"runtimeStartedAt":       node.RuntimeStartedAt,
		})
	}

	c.JSON(http.StatusOK, response)
}

// GetByID returns detailed information for a specific cluster node.
func (h *NodeHandler) GetByID(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	node, err := h.service.GetNodeByID(ctx, id)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get node timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get node: " + err.Error()})
		return
	}

	if node == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "node not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":                     node.ID,
		"name":                   node.Name,
		"hostname":               node.Hostname,
		"ip":                     node.IP,
		"status":                 node.Status,
		"version":                node.Version,
		"active_release_id":      node.ActiveReleaseID,
		"ruleset":                node.Ruleset,
		"sync":                   node.SyncStatus,
		"lastHeartbeat":          node.LastHeartbeat,
		"lastHeartbeatTimestamp": node.LastHeartbeatTimestamp,
		"created_at":             node.CreatedAt,
		"joinMethod":             node.JoinMethod,
		"certificate":            node.Certificate,
		"policySync":             node.PolicySync,
		"lastSyncTime":           node.LastSyncTime,
		"uptime":                 node.Uptime,
		"runtimeStartedAt":       node.RuntimeStartedAt,
	})
}

// Heartbeat processes Protobuf-encoded telemetry from data plane nodes.
func (h *NodeHandler) Heartbeat(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	contentType := c.GetHeader("Content-Type")
	if contentType != "application/x-protobuf" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{
			"error": "unsupported media type: application/x-protobuf required",
		})
		return
	}

	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 4096))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unable to read binary payload or payload exceeds 4KB"})
		return
	}

	payload, err := entity.UnmarshalNodeHeartbeat(body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to unmarshal Protobuf binary: " + err.Error()})
		return
	}

	if payload.NodeID == "" {
		payload.NodeID = nodeID
	} else if payload.NodeID != nodeID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID in path does not match payload"})
		return
	}

	if payload.Timestamp <= 0 || payload.Timestamp > time.Now().Unix()+60 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid heartbeat timestamp: must be positive and not skewed in the future"})
		return
	}

	payload.IP = c.ClientIP()
	payload.Authentication = "Bearer / HTTP"
	if c.Request.TLS != nil {
		payload.Authentication = "Bearer / TLS"
		if len(c.Request.TLS.VerifiedChains) > 0 {
			payload.Authentication = "mTLS verified"
		}
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeHeartbeatTimeout)
	defer cancel()

	directive, err := h.service.RecordHeartbeat(ctx, *payload)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "heartbeat processing timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to record heartbeat: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"action":             directive.Action,
		"desired_release_id": directive.DesiredReleaseID,
	})
}

// ReloadNode triggers a reload directive for a specific node.
func (h *NodeHandler) ReloadNode(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeReloadTimeout)
	defer cancel()

	if err := h.service.TriggerNodeReload(ctx, nodeID); err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "node reload timed out"})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Reload command dispatched to node " + nodeID + ". It will be executed on next heartbeat.",
		"status":  "pending",
	})
}

// RollingReload starts a sequential rolling reload across nodes.
func (h *NodeHandler) RollingReload(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeReloadTimeout)
	defer cancel()

	status, err := h.service.TriggerRollingReload(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "rolling reload timed out"})
			return
		}
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.RollingStatusResponse{
		Active:         status.Active,
		CurrentNodeID:  status.CurrentNodeID,
		PendingNodes:   status.PendingNodes,
		CompletedNodes: status.CompletedNodes,
		Message:        status.Message,
	})
}

// GetRollingStatus retrieves the current progress of rolling reload.
func (h *NodeHandler) GetRollingStatus(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	status, err := h.service.GetRollingStatus(ctx)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get rolling reload status timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.RollingStatusResponse{
		Active:         status.Active,
		CurrentNodeID:  status.CurrentNodeID,
		PendingNodes:   status.PendingNodes,
		CompletedNodes: status.CompletedNodes,
		Message:        status.Message,
	})
}

// EventsStream establishes a long-lived Server-Sent Events (SSE) stream to push real-time node telemetry to clients.
func (h *NodeHandler) EventsStream(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	eventChan, unsubscribe := h.service.SubscribeEvents()
	defer unsubscribe()

	c.SSEvent("ping", gin.H{"status": "connected"})
	if initialNodes, err := h.service.ListNodes(c.Request.Context()); err == nil && len(initialNodes) > 0 {
		c.SSEvent("nodes_snapshot", initialNodes)
	}
	c.Writer.Flush()

	keepAliveTicker := time.NewTicker(15 * time.Second)
	defer keepAliveTicker.Stop()

	clientDone := c.Request.Context().Done()

	for {
		select {
		case <-clientDone:
			return
		case <-keepAliveTicker.C:
			c.SSEvent("ping", gin.H{"status": "keepalive"})
			c.Writer.Flush()
		case msg, ok := <-eventChan:
			if !ok {
				return
			}
			data := msg.Data
			if beats, ok := msg.Data.([]entity.NodeHeartbeatEvent); ok {
				resp := make([]dto.NodeHeartbeatEventResponse, len(beats))
				for i, b := range beats {
					resp[i] = dto.NodeHeartbeatEventResponse{
						NodeID:    b.NodeID,
						IP:        b.IP,
						Status:    b.Status,
						Sync:      b.Sync,
						Ruleset:   b.Ruleset,
						Timestamp: b.Timestamp,
					}
				}
				data = resp
			}
			c.SSEvent(msg.Event, data)
			c.Writer.Flush()
		}
	}
}

// GetSyncLogs returns recent synchronization logs for a specific node.
func (h *NodeHandler) GetSyncLogs(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	logs, err := h.service.ListNodeSyncLogs(ctx, nodeID, 30)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "sync history query timed out"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to query sync history: " + err.Error()})
		return
	}

	resp := make([]dto.NodeSyncLogResponse, len(logs))
	for i, l := range logs {
		resp[i] = dto.NodeSyncLogResponse{
			ID:        l.ID,
			NodeID:    l.NodeID,
			EventType: l.EventType,
			ReleaseID: l.ReleaseID,
			Message:   l.Message,
			CreatedAt: l.CreatedAt,
		}
	}
	c.JSON(http.StatusOK, resp)
}

// GetConfig proxies the active NGINX configuration directly from the node container.
func (h *NodeHandler) GetConfig(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	config, err := h.service.GetNodeConfig(ctx, nodeID)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			c.JSON(http.StatusGatewayTimeout, gin.H{"error": "get node config timed out"})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"node_id":    nodeID,
		"path":       "/etc/nginx/nginx.conf",
		"config":     config,
		"fetched_at": time.Now().UTC().Format(time.RFC3339),
	})
}

// Delete deregisters or deletes a node from the cluster registry.
func (h *NodeHandler) Delete(c *gin.Context) {
	nodeID := c.Param("id")
	if nodeID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "node ID cannot be empty"})
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), nodeQueryTimeout)
	defer cancel()

	if err := h.service.DeleteNode(ctx, nodeID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete node: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "deleted", "id": nodeID})
}
