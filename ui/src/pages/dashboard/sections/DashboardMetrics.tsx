import React from 'react';
import {
  Activity,
  Cpu,
  HardDrive,
  Server,
  GitBranch,
  Network,
} from 'lucide-react';
import type { NodeRecord } from '../../../lib/api/nodes';
import type { SystemInfo } from '../../../lib/api/system';

interface DashboardMetricsProps {
  nodes: NodeRecord[];
  systemInfo: SystemInfo | null;
  isLoading?: boolean;
}

export function DashboardMetrics({
  nodes,
  systemInfo,
  isLoading = false,
}: DashboardMetricsProps) {
  const totalNodes = nodes.length;
  const readyNodes = nodes.filter((n) => n.status === 'Ready').length;

  // Aggregate RPS
  const totalRps = nodes.reduce((sum, n) => {
    const val = parseFloat(n.requestsPerSecond || '0');
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  // Aggregate Active Connections
  const totalConns = nodes.reduce((sum, n) => {
    const val = parseInt(n.activeConnections || '0', 10);
    return sum + (Number.isFinite(val) ? val : 0);
  }, 0);

  // Average CPU Usage
  const avgCpu =
    totalNodes > 0
      ? Math.round(
          nodes.reduce((sum, n) => sum + (n.cpuUsage || 0), 0) / totalNodes
        )
      : 0;

  // Average Memory Usage
  const avgMem =
    totalNodes > 0
      ? Math.round(
          nodes.reduce((sum, n) => sum + (n.memoryUsage || 0), 0) / totalNodes
        )
      : 0;

  // Spec Sync convergence (nodes where sync === 'In Sync')
  const inSyncCount = nodes.filter(
    (n) => n.sync === 'In Sync' || (n.ruleset && n.ruleset !== 'none')
  ).length;
  const driftCount = nodes.filter((n) => n.sync === 'Drift').length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 font-sans">
      {/* Card 1: Total Throughput (RPS) */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium">Cluster Throughput</span>
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
              <Activity className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold tabular-nums text-foreground">
            {totalRps.toFixed(1)}{' '}
            <span className="text-xs font-normal text-muted-foreground">req/s</span>
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
            <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
            <span>Across {totalNodes} node{totalNodes !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: totalRps > 0 ? `${Math.min(100, (totalRps / 1000) * 100)}%` : '2%' }}
          />
        </div>
      </div>

      {/* Card 2: Active Connections */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium">Active Connections</span>
            <div className="p-1.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400 rounded-xs">
              <Network className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold tabular-nums text-foreground">
            {totalConns}{' '}
            <span className="text-xs font-normal text-muted-foreground">conns</span>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            <span>NGINX client session pool</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-500"
            style={{ width: totalConns > 0 ? `${Math.min(100, (totalConns / 500) * 100)}%` : '2%' }}
          />
        </div>
      </div>

      {/* Card 3: Cluster CPU Load */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium">Avg CPU Pressure</span>
            <div
              className={`p-1.5 rounded-xs border ${
                avgCpu > 80
                  ? 'bg-destructive/10 border-destructive/20 text-destructive'
                  : avgCpu > 50
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold tabular-nums text-foreground">
            {avgCpu}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            <span>
              {avgCpu > 80
                ? 'High CPU pressure'
                : avgCpu > 50
                ? 'Moderate load'
                : 'Nominal capacity'}
            </span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              avgCpu > 80
                ? 'bg-destructive'
                : avgCpu > 50
                ? 'bg-amber-500'
                : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.max(3, avgCpu)}%` }}
          />
        </div>
      </div>

      {/* Card 4: Memory Usage */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium">Memory Usage</span>
            <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xs">
              <HardDrive className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold tabular-nums text-foreground">
            {avgMem}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-1 truncate" title={systemInfo?.memory_alloc_formatted ? `Control Plane: ${systemInfo.memory_alloc_formatted}` : undefined}>
            <span>
              {systemInfo?.memory_alloc_formatted
                ? `CP: ${systemInfo.memory_alloc_formatted}`
                : 'Node memory pool'}
            </span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${Math.max(3, avgMem)}%` }}
          />
        </div>
      </div>

      {/* Card 5: Data Plane Nodes */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium">Data Plane Nodes</span>
            <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xs">
              <Server className="w-3.5 h-3.5" />
            </div>
          </div>
          <div
            className={`text-xl font-bold tabular-nums ${
              readyNodes > 0 && readyNodes === totalNodes
                ? 'text-emerald-600 dark:text-emerald-400'
                : readyNodes > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-foreground'
            }`}
          >
            {readyNodes} / {totalNodes}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {totalNodes === 0
              ? 'No nodes registered'
              : readyNodes === totalNodes
              ? 'All nodes online'
              : `${totalNodes - readyNodes} degraded`}
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{
              width: totalNodes > 0 ? `${(readyNodes / totalNodes) * 100}%` : '0%',
            }}
          />
        </div>
      </div>

      {/* Card 6: Spec Sync Convergence */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium">Spec Convergence</span>
            <div
              className={`p-1.5 rounded-xs border ${
                driftCount > 0
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
            </div>
          </div>
          <div
            className={`text-xl font-bold tabular-nums ${
              driftCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-foreground'
            }`}
          >
            {inSyncCount} / {totalNodes || 1}
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            {driftCount > 0 ? (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {driftCount} node{driftCount > 1 ? 's' : ''} drifting
              </span>
            ) : (
              <span>Pull-by-hash synchronized</span>
            )}
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              driftCount > 0 ? 'bg-amber-500' : 'bg-violet-500'
            }`}
            style={{
              width:
                totalNodes > 0
                  ? `${(inSyncCount / totalNodes) * 100}%`
                  : '100%',
            }}
          />
        </div>
      </div>
    </div>
  );
}
