import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  RotateCw,
  ArrowUpDown,
  Filter,
} from 'lucide-react';

export interface NodeItem {
  runtimeStartedAt?: number;
  metricsScope?: string;
  metricsAvailable?: boolean;
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
  lastHeartbeatTimestamp?: number;
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
  onRefresh?: () => void | Promise<void>;
  selectedNodeId: string;
  onSelectNode: (node: NodeItem) => void;
}

export function NodesTable({
  nodes: nodesProp,
  isLoading = false,
  onRefresh,
  selectedNodeId,
  onSelectNode,
}: NodesTableProps) {
  const nodes = nodesProp || [];
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sort, setSort] = useState<{field: 'name' | 'status'; direction: number}>({field:'name',direction:1});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const [indicator, setIndicator] = useState<{ top: number; height: number; visible: boolean }>({
    top: 0,
    height: 0,
    visible: false,
  });

  const updateIndicatorPosition = () => {
    if (!selectedNodeId) {
      setIndicator((prev) => ({ ...prev, visible: false }));
      return;
    }
    const row = rowRefs.current[selectedNodeId];
    if (row) {
      setIndicator({
        top: row.offsetTop,
        height: row.offsetHeight,
        visible: true,
      });
    } else {
      setIndicator((prev) => ({ ...prev, visible: false }));
    }
  };

  useEffect(() => {
    updateIndicatorPosition();
    const rafId = requestAnimationFrame(updateIndicatorPosition);
    return () => cancelAnimationFrame(rafId);
  }, [selectedNodeId, nodesProp]);

  useEffect(() => {
    window.addEventListener('resize', updateIndicatorPosition);
    return () => window.removeEventListener('resize', updateIndicatorPosition);
  }, [selectedNodeId]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try { await onRefresh?.(); } finally { setIsRefreshing(false); }
  };

  const filteredNodes = nodes.filter((node) => {
    const matchesSearch =
      node.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      node.ip.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (node.hostname && node.hostname.toLowerCase().includes(searchQuery.toLowerCase())) ||
      node.ruleset.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole = roleFilter === 'ALL' || node.role.includes(roleFilter);
    const matchesStatus =
      statusFilter === 'ALL' || node.status === statusFilter;

    return matchesSearch && matchesRole && matchesStatus;
  }).sort((a,b) => sort.direction * a[sort.field].localeCompare(b[sort.field], undefined, {numeric:true}));

  return (
    <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] flex flex-col shadow-xs rounded-sm transition-colors">
      {/* Header Bar */}
      <div className="p-4 border-b border-slate-200 dark:border-[#152030] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            Nodes ({nodes.length})
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] hover:border-slate-400 dark:hover:border-slate-500 text-xs font-sans text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-sm"
          >
            <RotateCw
              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-500 dark:text-emerald-400' : 'text-slate-400'}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="px-4 py-2.5 bg-slate-50/70 dark:bg-[#080E18] border-b border-slate-200 dark:border-[#152030] flex flex-wrap items-center gap-3 font-sans">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search nodes..."
            className="w-full bg-white dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] pl-8 pr-3 py-1 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 font-sans focus:outline-none focus:border-blue-500 rounded-sm"
          />
        </div>

        {/* Role Filter */}
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="bg-white dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] px-2.5 py-1 text-xs text-slate-800 dark:text-slate-300 font-sans focus:outline-none focus:border-blue-500 cursor-pointer rounded-sm"
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
          className="bg-white dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] px-2.5 py-1 text-xs text-slate-800 dark:text-slate-300 font-sans focus:outline-none focus:border-blue-500 cursor-pointer rounded-sm"
        >
          <option value="ALL">All Statuses</option>
          <option value="Ready">Ready</option>
          <option value="Not Ready">Not Ready</option>
          <option value="Draining">Draining</option>
        </select>
      </div>

      {/* Refresh Progress Indicator Line */}
      <div className="h-0.5 w-full bg-[#152030] overflow-hidden relative">
        {isRefreshing && (
          <div className="h-full bg-gradient-to-r from-transparent via-emerald-400 to-transparent w-full animate-pulse transition-all duration-300" />
        )}
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto font-sans relative">
        {/* Animated Selection Indicator Bar */}
        <div
          className="absolute left-0 w-[3.5px] bg-sky-500 dark:bg-emerald-400 rounded-r-xs pointer-events-none transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] z-10"
          style={{
            top: `${indicator.top}px`,
            height: `${indicator.height}px`,
            opacity: indicator.visible ? 1 : 0,
            transform: 'translateZ(0)',
          }}
        />

        <table className="w-full text-left border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-200 dark:border-[#152030] bg-slate-50 dark:bg-[#0E1726]/70 text-xs font-sans text-slate-500 dark:text-slate-400">
              <th className="py-2.5 px-3 font-medium">
                <button type="button" onClick={() => setSort(prev => ({field: 'name', direction: prev.field === 'name' ? -prev.direction : 1}))} className="flex items-center gap-1 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">
                  <span>Node Name</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                </button>
              </th>
              <th className="py-2.5 px-3 font-medium">IP Address</th>
              <th className="py-2.5 px-3 font-medium">Hostname</th>
              <th className="py-2.5 px-3 font-medium">Role</th>
              <th className="py-2.5 px-3 font-medium">
                <button type="button" onClick={() => setSort(prev => ({field: 'status', direction: prev.field === 'status' ? -prev.direction : 1}))} className="flex items-center gap-1 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">
                  <span>Status</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                </button>
              </th>
              <th className="py-2.5 px-3 font-medium">Version</th>
              <th className="py-2.5 px-3 font-medium">Ruleset</th>
              <th className="py-2.5 px-3 font-medium">RPS</th>
              <th className="py-2.5 px-3 font-medium">Connections</th>
              <th className="py-2.5 px-3 font-medium">Last Heartbeat</th>
              <th className="py-2.5 px-3 font-medium text-right">Sync</th>
            </tr>
          </thead>
          <tbody
            className={`divide-y divide-slate-100 dark:divide-[#152030] text-xs font-sans transition-opacity duration-300 ${
              isRefreshing ? 'opacity-60' : 'opacity-100'
            }`}
          >
            {isLoading && nodes.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-slate-400 dark:text-slate-500">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <RotateCw className="w-5 h-5 animate-spin text-emerald-500 dark:text-emerald-400" />
                    <span>Loading cluster nodes...</span>
                  </div>
                </td>
              </tr>
            ) : filteredNodes.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-12 text-center text-slate-400 dark:text-slate-500">
                  {nodes.length === 0
                    ? 'No nodes registered in the cluster yet.'
                    : 'No nodes found matching the filter criteria.'}
                </td>
              </tr>
            ) : (
              filteredNodes.map((node) => {
                const isSelected = selectedNodeId === node.id;
                return (
                  <tr
                    key={node.id}
                    ref={(el) => {
                      rowRefs.current[node.id] = el;
                    }}
                    onClick={() => onSelectNode(node)}
                    className={`cursor-pointer transition-colors duration-200 ${
                      isSelected
                        ? 'bg-sky-50/80 dark:bg-emerald-950/25'
                        : 'hover:bg-slate-50 dark:hover:bg-[#0E1726]/60'
                    }`}
                  >
                    {/* Node Name */}
                    <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-900 dark:text-white font-mono font-bold">{node.name}</span>
                      </div>
                    </td>

                    {/* IP Address */}
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{node.ip}</td>

                    {/* Hostname */}
                    <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{node.hostname || 'Unknown'}</td>

                    {/* Role */}
                    <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{node.role || 'Unknown'}</td>

                    {/* Status */}
                    <td className="py-2 px-3">
                      {node.status === 'Ready' ? (
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-500/50 text-emerald-700 dark:text-emerald-400 text-[10px] rounded-xs font-bold">
                          Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/50 text-rose-700 dark:text-rose-400 text-[10px] rounded-xs font-bold">
                          Not Ready
                        </span>
                      )}
                    </td>

                    {/* Version */}
                    <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{node.version}</td>

                    {/* Ruleset */}
                    <td className="py-2 px-3 text-blue-600 dark:text-cyan-400">{node.ruleset}</td>

                    {/* RPS */}
                    <td className="py-2 px-3 text-slate-800 dark:text-slate-200">{node.metricsAvailable ? node.requestsPerSecond : '—'}</td>

                    {/* Connections */}
                    <td className="py-2 px-3 text-slate-800 dark:text-slate-200">
                      {node.metricsAvailable ? node.activeConnections : '—'}
                    </td>

                    {/* Last Heartbeat */}
                    <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                      {node.lastHeartbeat}
                    </td>

                    {/* Sync */}
                    <td className="py-2 px-3 text-right">
                      {node.sync === 'In Sync' && node.status === 'Ready' ? (
                        <span className="inline-flex items-center px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px] rounded-xs font-bold">
                          In Sync
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 text-[10px] rounded-xs font-bold">
                          {node.status === 'Ready' ? node.sync : 'Unknown'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Table Footer */}
      <div className="p-3 bg-slate-50 dark:bg-[#080E18] border-t border-slate-200 dark:border-[#152030] flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
        <div>
          Tổng số: <span className="text-slate-900 dark:text-slate-200 font-semibold">{filteredNodes.length}</span> node
        </div>
      </div>
    </div>
  );
}
