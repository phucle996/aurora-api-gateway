import React, { useState, useEffect, useCallback } from 'react';
import { NodesStats } from './sections/NodesStats';
import { NodesTable, type NodeItem } from './sections/NodesTable';
import { NodeDetail } from './sections/NodeDetail';
import { nodesApi } from '../../lib/api';
import { API_BASE_URL, getAuthToken } from '../../lib/fetcher';

// Tính toán thời gian tương đối động từ timestamp
export function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Never';
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours}h ago`;
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [latestHeartbeatEvent, setLatestHeartbeatEvent] = useState<any>(null);
  const [latestSyncEvent, setLatestSyncEvent] = useState<any>(null);

  const fetchNodes = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setIsLoading(true);
    }
    try {
      const res = await nodesApi.list();
      if (Array.isArray(res)) {
        const mapped: NodeItem[] = res.map((item: any) => {
          let ts: number = Date.now();
          if (item.lastHeartbeatTimestamp) {
            ts = item.lastHeartbeatTimestamp * 1000;
          } else if (item.lastHeartbeat) {
            const match = item.lastHeartbeat.match(/^(\d+)s ago$/);
            if (match) {
              ts = Date.now() - parseInt(match[1], 10) * 1000;
            } else {
              const matchMin = item.lastHeartbeat.match(/^(\d+)m ago$/);
              if (matchMin) {
                ts = Date.now() - parseInt(matchMin[1], 10) * 60 * 1000;
              }
            }
          }
          return {
            ...item,
            lastHeartbeatTimestamp: ts,
            lastHeartbeat: formatRelativeTime(ts),
          };
        });
        setNodes(mapped);
        // Cập nhật lại thông tin node đang xem (nếu có), không tự động mở node đầu tiên
        setSelectedNode((prev) => {
          if (!prev || mapped.length === 0) return null;
          return mapped.find((n) => n.id === prev.id) || null;
        });
      }
    } catch (err) {
      console.error('Failed to fetch cluster nodes:', err);
    } finally {
      if (isInitial) {
        setIsLoading(false);
      }
    }
  }, []);

  // 1. Tải danh sách nodes ban đầu
  useEffect(() => {
    fetchNodes(true);
  }, [fetchNodes]);

  // 2. Dynamic Relative Time Ticker: Tự động đếm giây (Xs ago / Xm ago) theo thời gian thực
  useEffect(() => {
    const timer = setInterval(() => {
      setNodes((prev) => {
        let changed = false;
        const next = prev.map((n) => {
          if (!n.lastHeartbeatTimestamp) return n;
          const updatedText = formatRelativeTime(n.lastHeartbeatTimestamp);
          const diffSec = Math.floor((Date.now() - n.lastHeartbeatTimestamp) / 1000);
          const nextStatus = diffSec > 45 ? 'Not Ready' : n.status;

          if (n.lastHeartbeat !== updatedText || n.status !== nextStatus) {
            changed = true;
            return {
              ...n,
              lastHeartbeat: updatedText,
              status: nextStatus as any,
              uptime: nextStatus === 'Not Ready' ? 'Offline' : n.uptime,
            };
          }
          return n;
        });
        return changed ? next : prev;
      });

      setSelectedNode((prev) => {
        if (!prev || !prev.lastHeartbeatTimestamp) return prev;
        const updatedText = formatRelativeTime(prev.lastHeartbeatTimestamp);
        const diffSec = Math.floor((Date.now() - prev.lastHeartbeatTimestamp) / 1000);
        const nextStatus = diffSec > 45 ? 'Not Ready' : prev.status;

        if (prev.lastHeartbeat !== updatedText || prev.status !== nextStatus) {
          return {
            ...prev,
            lastHeartbeat: updatedText,
            status: nextStatus as any,
            uptime: nextStatus === 'Not Ready' ? 'Offline' : prev.uptime,
          };
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // 3. Vòng đời SSE: Chỉ khởi tạo khi mount vào NodesPage và ngắt kết nối ngay khi unmount
  useEffect(() => {
    const token = getAuthToken();
    const streamUrl = `${API_BASE_URL}/api/v1/events/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(streamUrl, { withCredentials: true });

    const handleHeartbeatsBatch = (items: any[]) => {
      if (!Array.isArray(items) || items.length === 0) return;

      const updateMap = new Map(items.map((it) => [it.node_id, it]));

      // Cập nhật một lần duy nhất cho toàn bộ bảng Nodes (tránh re-render rời rạc)
      setNodes((prev) =>
        prev.map((n) => {
          const update = updateMap.get(n.id);
          if (!update) return n;
          const ts = update.timestamp ? update.timestamp * 1000 : Date.now();
          return {
            ...n,
            ip: update.ip || n.ip,
            status: update.status || n.status,
            requestsPerSecond:
              update.rps != null ? Number(update.rps).toFixed(1) : n.requestsPerSecond,
            activeConnections:
              update.active_conns != null ? String(update.active_conns) : n.activeConnections,
            cpuUsage: update.cpu_usage != null ? update.cpu_usage : n.cpuUsage,
            memoryUsage: update.memory_usage != null ? update.memory_usage : n.memoryUsage,
            sync: update.sync || n.sync,
            ruleset: update.ruleset || n.ruleset,
            lastHeartbeatTimestamp: ts,
            lastHeartbeat: formatRelativeTime(ts),
          };
        })
      );

      // Cập nhật node đang mở chi tiết (nếu có trong batch)
      setSelectedNode((prev) => {
        if (!prev) return prev;
        const update = updateMap.get(prev.id);
        if (!update) return prev;
        setLatestHeartbeatEvent(update);
        const ts = update.timestamp ? update.timestamp * 1000 : Date.now();
        return {
          ...prev,
          ip: update.ip || prev.ip,
          status: update.status || prev.status,
          requestsPerSecond:
            update.rps != null ? Number(update.rps).toFixed(1) : prev.requestsPerSecond,
          activeConnections:
            update.active_conns != null ? String(update.active_conns) : prev.activeConnections,
          cpuUsage: update.cpu_usage != null ? update.cpu_usage : prev.cpuUsage,
          memoryUsage: update.memory_usage != null ? update.memory_usage : prev.memoryUsage,
          sync: update.sync || prev.sync,
          ruleset: update.ruleset || prev.ruleset,
          lastHeartbeatTimestamp: ts,
          lastHeartbeat: formatRelativeTime(ts),
        };
      });
    };

    const handleMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const list = Array.isArray(data) ? data : [data];
        handleHeartbeatsBatch(list);
      } catch (err) {
        console.error('Failed to parse SSE heartbeats batch:', err);
      }
    };

    es.addEventListener('nodes_heartbeat', handleMessage);
    es.addEventListener('node_heartbeat', handleMessage);

    es.addEventListener('node_sync', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data) {
          setLatestSyncEvent(data);
        }
      } catch (err) {
        console.error('Failed to parse SSE node_sync:', err);
      }
    });

    // Cleanup: Ngắt kết nối SSE ngay khi người dùng rời khỏi trang Nodes
    return () => {
      es.close();
    };
  }, []);

  const handleSelectNode = (node: NodeItem) => {
    // Click vào item đang chọn -> ẩn chi tiết để kéo dãn bảng full-width
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Top KPI Metrics & Cluster Status */}
      <NodesStats nodes={nodes} />

      {/* Grid: Nodes Table + Right Drawer / Detail */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Table Area: Tự động kéo dãn toàn màn hình khi đóng panel chi tiết */}
        <div className="flex-1 min-w-0 w-full transition-all duration-200">
          <NodesTable
            nodes={nodes}
            isLoading={isLoading}
            onRefresh={() => fetchNodes(false)}
            selectedNodeId={selectedNode?.id || ''}
            onSelectNode={handleSelectNode}
          />
        </div>

        {/* Selected Node Detail Panel: Chỉ hiện khi click xem chi tiết */}
        {selectedNode && (
          <div className="w-full lg:w-[420px] shrink-0 transition-all duration-200">
            <NodeDetail
              node={selectedNode}
              latestHeartbeatEvent={latestHeartbeatEvent}
              latestSyncEvent={latestSyncEvent}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

