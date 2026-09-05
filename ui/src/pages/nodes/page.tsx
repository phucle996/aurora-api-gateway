import React, { useState, useEffect, useCallback } from 'react';
import { NodesStats } from './sections/NodesStats';
import { NodesTable, type NodeItem } from './sections/NodesTable';
import { NodeDetail } from './sections/NodeDetail';
import { nodesApi } from '../../lib/api';

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchNodes = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await nodesApi.list();
      if (Array.isArray(res)) {
        setNodes(res);
        setSelectedNode((prev) => {
          if (res.length === 0) return null;
          const match = prev ? res.find((n) => n.id === prev.id) : null;
          return match || res[0];
        });
      }
    } catch (err) {
      console.error('Failed to fetch cluster nodes:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  return (
    <div className="p-6 space-y-6">
      {/* Top KPI Metrics & Cluster Status */}
      <NodesStats nodes={nodes} />

      {/* Grid: Nodes Table + Right Drawer / Detail */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Table Area */}
        <div className="flex-1 min-w-0 w-full">
          <NodesTable
            nodes={nodes}
            isLoading={isLoading}
            onRefresh={fetchNodes}
            selectedNodeId={selectedNode?.id || ''}
            onSelectNode={(node) => setSelectedNode(node)}
          />
        </div>

        {/* Selected Node Detail Panel */}
        {selectedNode ? (
          <NodeDetail node={selectedNode} />
        ) : (
          <div className="w-full lg:w-[380px] shrink-0 bg-[#0B1320] border border-[#152030] p-6 text-center text-slate-500 font-mono text-xs">
            No node selected
          </div>
        )}
      </div>
    </div>
  );
}

