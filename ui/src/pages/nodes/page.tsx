import React, { useState } from 'react';
import { NodesStats } from './sections/NodesStats';
import { NodesTable, INITIAL_NODES, type NodeItem } from './sections/NodesTable';
import { NodeDetail } from './sections/NodeDetail';
import { GenerateTokenModal } from './sections/GenerateTokenModal';

export default function NodesPage() {
  const [selectedNode, setSelectedNode] = useState<NodeItem>(INITIAL_NODES[0]);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);

  return (
    <div className="p-6 space-y-6">
      {/* Top KPI Metrics & Cluster Status */}
      <NodesStats />

      {/* Grid: Nodes Table + Right Drawer / Detail */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">
        {/* Table Area */}
        <div className="flex-1 min-w-0 w-full">
          <NodesTable
            selectedNodeId={selectedNode.id}
            onSelectNode={(node) => setSelectedNode(node)}
            onOpenGenerateToken={() => setIsTokenModalOpen(true)}
          />
        </div>

        {/* Selected Node Detail Panel */}
        <NodeDetail node={selectedNode} />
      </div>

      {/* Generate Token Modal */}
      <GenerateTokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
      />
    </div>
  );
}
