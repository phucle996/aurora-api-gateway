import React, { useState, useEffect, useCallback } from 'react';
import { NodesStats } from './sections/NodesStats';
import { NodesTable, INITIAL_NODES, type NodeItem } from './sections/NodesTable';
import { NodeDetail } from './sections/NodeDetail';
import { GenerateTokenModal } from './sections/GenerateTokenModal';
import { nodesApi } from '../../lib/api';

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeItem>(INITIAL_NODES[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);

  const fetchNodes = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await nodesApi.list();
      if (Array.isArray(res) && res.length > 0) {
        setNodes(res);
        setSelectedNode((prev) => {
          const match = res.find((n) => n.id === prev.id);
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
      <NodesStats nodes={nodes.length > 0 ? nodes : undefined} />

      {/* Grid: Nodes Table + Right Drawer / Detail */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Table Area */}
        <div className="flex-1 min-w-0 w-full">
          <NodesTable
            nodes={nodes.length > 0 ? nodes : undefined}
            isLoading={isLoading}
            onRefresh={fetchNodes}
            selectedNodeId={selectedNode?.id || ''}
            onSelectNode={(node) => setSelectedNode(node)}
            onOpenGenerateToken={() => setIsTokenModalOpen(true)}
          />
        </div>

        {/* Selected Node Detail Panel */}
        {selectedNode && <NodeDetail node={selectedNode} />}
      </div>

      {/* Generate Token Modal */}
      <GenerateTokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
      />
    </div>
  );
}

