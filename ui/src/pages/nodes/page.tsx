import React, { useState, useEffect, useCallback } from 'react';
import { NodesStats } from './sections/NodesStats';
import { NodesTable, type NodeItem } from './sections/NodesTable';
import { NodeDetail } from './sections/NodeDetail';
import { nodesApi } from '../../lib/api';
import { API_BASE_URL, getAuthToken } from '../../lib/fetcher';

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
        setNodes(res);
        // Cập nhật lại thông tin node đang xem (nếu có), không tự động mở node đầu tiên
        setSelectedNode((prev) => {
          if (!prev || res.length === 0) return null;
          return res.find((n) => n.id === prev.id) || null;
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

  // 2. Vòng đời SSE: Chỉ khởi tạo khi mount vào NodesPage và ngắt kết nối ngay khi unmount
  useEffect(() => {
    const token = getAuthToken();
    const streamUrl = `${API_BASE_URL}/api/v1/events/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(streamUrl, { withCredentials: true });

    es.addEventListener('node_heartbeat', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (!data || !data.node_id) return;

        setLatestHeartbeatEvent(data);

        // Cập nhật realtime cho bảng danh sách Nodes (kể cả khi chưa mở chi tiết)
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== data.node_id) return n;
            return {
              ...n,
              ip: data.ip || n.ip,
              status: data.status || n.status,
              requestsPerSecond:
                data.rps != null ? Number(data.rps).toFixed(1) : n.requestsPerSecond,
              activeConnections:
                data.active_conns != null ? String(data.active_conns) : n.activeConnections,
              sync: data.sync || n.sync,
              ruleset: data.ruleset || n.ruleset,
              lastHeartbeat: '0s ago',
            };
          })
        );

        // Cập nhật realtime cho node đang mở chi tiết (nếu có)
        setSelectedNode((prev) => {
          if (!prev || prev.id !== data.node_id) return prev;
          return {
            ...prev,
            ip: data.ip || prev.ip,
            status: data.status || prev.status,
            requestsPerSecond:
              data.rps != null ? Number(data.rps).toFixed(1) : prev.requestsPerSecond,
            activeConnections:
              data.active_conns != null ? String(data.active_conns) : prev.activeConnections,
            sync: data.sync || prev.sync,
            ruleset: data.ruleset || prev.ruleset,
            lastHeartbeat: '0s ago',
          };
        });
      } catch (err) {
        console.error('Failed to parse SSE node_heartbeat:', err);
      }
    });

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

