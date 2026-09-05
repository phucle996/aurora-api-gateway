import React, { useState } from 'react';
import {
  Search,
  RotateCw,
  Key,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Filter,
} from 'lucide-react';

export interface NodeItem {
  id: string;
  name: string;
  hostname?: string;
  ip: string;
  region?: string;
  regionFull?: string;
  role: string;
  status: 'Ready' | 'Not Ready' | 'Draining';
  version: string;
  ruleset: string;
  rps?: string;
  connections?: string;
  lastHeartbeat: string;
  sync: 'In Sync' | 'Drift' | 'Syncing';
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: string;
  requestsPerSecond: string;
  uptime: string;
  joinMethod: string;
  certificate: string;
  policySync: string;
  lastSyncTime: string;
  created_at?: string;
}

interface NodesTableProps {
  nodes?: NodeItem[];
  isLoading?: boolean;
  onRefresh?: () => void;
  selectedNodeId: string;
  onSelectNode: (node: NodeItem) => void;
  onOpenGenerateToken: () => void;
}

export function NodesTable({
  nodes: nodesProp,
  isLoading = false,
  onRefresh,
  selectedNodeId,
  onSelectNode,
  onOpenGenerateToken,
}: NodesTableProps) {
  const nodes = nodesProp || [];
  const [searchQuery, setSearchQuery] = useState('');
  const [regionFilter, setRegionFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currentPage, setCurrentPage] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    if (onRefresh) {
      onRefresh();
    }
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  };

  const filteredNodes = nodes.filter((node) => {
    const matchesSearch =
      node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.ip.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (node.hostname && node.hostname.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (node.region && node.region.toLowerCase().includes(searchQuery.toLowerCase())) ||
      node.ruleset.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRegion =
      regionFilter === 'ALL' || node.region === regionFilter;
    const matchesRole = roleFilter === 'ALL' || node.role.includes(roleFilter);
    const matchesStatus =
      statusFilter === 'ALL' || node.status === statusFilter;

    return matchesSearch && matchesRegion && matchesRole && matchesStatus;
  });

  return (
    <div className="bg-[#0B1320] border border-[#152030] flex flex-col">
      {/* Header Bar */}
      <div className="p-4 border-b border-[#152030] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            Nodes ({nodes.length})
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E1726] border border-[#1C293D] hover:border-slate-500 text-xs font-mono text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <RotateCw
              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : 'text-slate-400'}`}
            />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={onOpenGenerateToken}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500 text-xs font-semibold text-white transition-colors cursor-pointer shadow-sm"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Generate Join Token</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="px-4 py-2.5 bg-[#080E18] border-b border-[#152030] flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-full bg-[#0E1726] border border-[#1C293D] pl-8 pr-3 py-1 text-xs text-slate-200 placeholder:text-slate-500 font-mono focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Region Filter */}
        <select
          value={regionFilter}
          onChange={(e) => setRegionFilter(e.target.value)}
          className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
        >
          <option value="ALL">All Regions</option>
          <option value="SG">Singapore (SG)</option>
          <option value="JP">Japan (JP)</option>
          <option value="DE">Germany (DE)</option>
          <option value="US">United States (US)</option>
          <option value="VN">Vietnam (VN)</option>
          <option value="IN">India (IN)</option>
          <option value="AU">Australia (AU)</option>
          <option value="GB">Great Britain (GB)</option>
          <option value="CA">Canada (CA)</option>
        </select>

        {/* Role Filter */}
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
        >
          <option value="ALL">All Roles</option>
          <option value="Edge">Edge</option>
          <option value="Ingress">Ingress</option>
          <option value="Internal">Internal</option>
        </select>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
        >
          <option value="ALL">All Statuses</option>
          <option value="Ready">Ready</option>
          <option value="Not Ready">Not Ready</option>
          <option value="Draining">Draining</option>
        </select>
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#152030] bg-[#0E1726]/70 text-[11px] font-mono text-slate-400">
              <th className="py-2.5 px-3 font-medium">
                <div className="flex items-center gap-1 cursor-pointer hover:text-slate-200">
                  <span>Node Name</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th className="py-2.5 px-3 font-medium">IP Address</th>
              <th className="py-2.5 px-3 font-medium">Hostname</th>
              <th className="py-2.5 px-3 font-medium">Role</th>
              <th className="py-2.5 px-3 font-medium">
                <div className="flex items-center gap-1 cursor-pointer hover:text-slate-200">
                  <span>Status</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th className="py-2.5 px-3 font-medium">Version</th>
              <th className="py-2.5 px-3 font-medium">Ruleset</th>
              <th className="py-2.5 px-3 font-medium">RPS</th>
              <th className="py-2.5 px-3 font-medium">Connections</th>
              <th className="py-2.5 px-3 font-medium">Last Heartbeat</th>
              <th className="py-2.5 px-3 font-medium">Sync</th>
              <th className="py-2.5 px-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#152030] text-xs font-mono">
            {isLoading ? (
              <tr>
                <td colSpan={12} className="py-12 text-center text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RotateCw className="w-5 h-5 animate-spin text-emerald-400" />
                    <span>Loading cluster nodes...</span>
                  </div>
                </td>
              </tr>
            ) : filteredNodes.length === 0 ? (
              <tr>
                <td colSpan={12} className="py-12 text-center text-slate-500">
                  {nodes.length === 0
                    ? 'No nodes registered in the cluster yet. Use "Generate Join Token" to onboard a node.'
                    : 'No nodes found matching the filter criteria.'}
                </td>
              </tr>
            ) : (
              filteredNodes.map((node) => {
                const isSelected = selectedNodeId === node.id;
                return (
                  <tr
                    key={node.id}
                    onClick={() => onSelectNode(node)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-emerald-950/20 border-l-2 border-l-emerald-400'
                        : 'hover:bg-[#0E1726]/60'
                    }`}
                  >
                    {/* Node Name */}
                    <td className="py-2 px-3 font-medium text-slate-100 flex items-center gap-2">
                      <span className="text-white font-mono">{node.name}</span>
                    </td>

                    {/* IP Address */}
                    <td className="py-2 px-3 text-slate-300">{node.ip}</td>

                    {/* Hostname */}
                    <td className="py-2 px-3 text-slate-400">{node.hostname || node.region || 'localhost'}</td>

                    {/* Role */}
                    <td className="py-2 px-3 text-slate-300">{node.role || 'Edge'}</td>

                    {/* Status */}
                    <td className="py-2 px-3">
                      {node.status === 'Ready' ? (
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 text-[10px]">
                          Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 bg-rose-950/60 border border-rose-500/50 text-rose-400 text-[10px]">
                          Not Ready
                        </span>
                      )}
                    </td>

                    {/* Version */}
                    <td className="py-2 px-3 text-slate-400">{node.version}</td>

                    {/* Ruleset */}
                    <td className="py-2 px-3 text-cyan-400">{node.ruleset}</td>

                    {/* RPS */}
                    <td className="py-2 px-3 text-slate-200">{node.rps || node.requestsPerSecond}</td>

                    {/* Connections */}
                    <td className="py-2 px-3 text-slate-200">
                      {node.connections || node.activeConnections}
                    </td>

                    {/* Last Heartbeat */}
                    <td className="py-2 px-3 text-slate-400">
                      {node.lastHeartbeat}
                    </td>

                    {/* Sync */}
                    <td className="py-2 px-3">
                      {node.sync === 'In Sync' ? (
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-950/40 border border-emerald-500/40 text-emerald-400 text-[10px]">
                          In Sync
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 bg-amber-950/40 border border-amber-500/40 text-amber-400 text-[10px]">
                          {node.sync || 'Syncing'}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-2 px-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        className="p-1 hover:bg-[#152030] text-slate-400 hover:text-white transition-colors cursor-pointer"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-3 bg-[#080E18] border-t border-[#152030] flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-slate-400">
        <div>
          Showing {filteredNodes.length > 0 ? 1 : 0}-{filteredNodes.length} of {filteredNodes.length} nodes
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 hover:bg-[#0E1726] border border-[#1C293D] text-slate-400 disabled:opacity-30 cursor-pointer"
            disabled
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="px-2.5 py-1 bg-emerald-600 border border-emerald-500 text-white font-bold cursor-pointer"
          >
            1
          </button>
          <button
            type="button"
            className="p-1 hover:bg-[#0E1726] border border-[#1C293D] text-slate-400 disabled:opacity-30 cursor-pointer"
            disabled
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
