import React, { useState, useEffect, useCallback } from 'react';
import { NodesStats } from './sections/NodesStats';
import { NodesTable, type NodeItem } from './sections/NodesTable';
import { NodeDetail } from './sections/NodeDetail';
import { nodesApi } from '../../lib/api';

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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

  useEffect(() => {
    fetchNodes(true);
  }, [fetchNodes]);

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
            <NodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

