import React from 'react';
import {
  Server,
  HeartPulse,
  CheckCircle2,
  GitBranch,
} from 'lucide-react';
import type { NodeRecord } from '../../../lib/api/nodes';
import type { ClusterSpecInfo } from '../../../lib/api/spec';

interface DashboardMetricsProps {
  nodes: NodeRecord[];
  clusterSpec?: ClusterSpecInfo | null;
  isLoading?: boolean;
}

export function DashboardMetrics({
  nodes,
  clusterSpec,
  isLoading = false,
}: DashboardMetricsProps) {
  const totalNodes = nodes.length;

  // 1. Liveness: Node has sent heartbeat recently (within 15s)
  const now = Date.now();
  const aliveNodes = nodes.filter((n) => {
    if (!n.lastHeartbeatTimestamp) return n.status === 'Ready';
    const ageSecs = (now - n.lastHeartbeatTimestamp) / 1000;
    return ageSecs < 20;
  }).length;
  const deadNodes = totalNodes - aliveNodes;

  // 2. Readiness: NGINX status is 'Ready' (serving traffic)
  const readyNodes = nodes.filter((n) => n.status === 'Ready').length;
  const notReadyNodes = totalNodes - readyNodes;

  // 3. Spec Convergence: Node has matched active cluster digest / in_sync
  const inSyncCount = nodes.filter(
    (n) => n.sync === 'In Sync' || (n.ruleset && n.ruleset !== 'none')
  ).length;
  const driftCount = nodes.filter((n) => n.sync === 'Drift').length;
  const isAllInSync = totalNodes > 0 && inSyncCount === totalNodes;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-sans">
      {/* KPI 1: Registered Fleet */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">Registered Fleet</span>
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {totalNodes}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <span>Stateless data plane instances</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: totalNodes > 0 ? '100%' : '0%' }}
          />
        </div>
      </div>

      {/* KPI 2: Fleet Liveness */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">Fleet Liveness</span>
            <div
              className={`p-1.5 rounded-xs border ${
                deadNodes === 0 && totalNodes > 0
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-destructive/10 border-destructive/20 text-destructive'
              }`}
            >
              <HeartPulse className="w-4 h-4" />
            </div>
          </div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              deadNodes === 0 && totalNodes > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : deadNodes > 0
                ? 'text-destructive'
                : 'text-foreground'
            }`}
          >
            {aliveNodes} / {totalNodes}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                deadNodes === 0 && totalNodes > 0
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-destructive'
              }`}
            />
            <span>
              {totalNodes === 0
                ? 'No pods connected'
                : deadNodes === 0
                ? 'All nodes heartbeat active (<15s)'
                : `${deadNodes} node(s) missing heartbeat`}
            </span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              deadNodes === 0 ? 'bg-emerald-500' : 'bg-destructive'
            }`}
            style={{
              width: totalNodes > 0 ? `${(aliveNodes / totalNodes) * 100}%` : '0%',
            }}
          />
        </div>
      </div>

      {/* KPI 3: Traffic Readiness */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">Traffic Readiness</span>
            <div className="p-1.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400 rounded-xs">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              readyNodes === totalNodes && totalNodes > 0
                ? 'text-foreground'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {readyNodes} / {totalNodes}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <span>
              {totalNodes === 0
                ? 'Awaiting ingress traffic'
                : readyNodes === totalNodes
                ? 'NGINX workers active & listening'
                : `${notReadyNodes} node(s) draining or reloading`}
            </span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-500 transition-all duration-500"
            style={{
              width: totalNodes > 0 ? `${(readyNodes / totalNodes) * 100}%` : '0%',
            }}
          />
        </div>
      </div>

      {/* KPI 4: Spec Convergence */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">Spec Convergence</span>
            <div
              className={`p-1.5 rounded-xs border ${
                driftCount > 0
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400'
              }`}
            >
              <GitBranch className="w-4 h-4" />
            </div>
          </div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              driftCount > 0
                ? 'text-amber-600 dark:text-amber-400'
                : isAllInSync
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-foreground'
            }`}
          >
            {inSyncCount} / {totalNodes || 1}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            {driftCount > 0 ? (
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {driftCount} node(s) pulling / drifting
              </span>
            ) : isAllInSync ? (
              <span>100% converged with target digest</span>
            ) : (
              <span>Baseline hash matched</span>
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
