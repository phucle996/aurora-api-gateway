import React from 'react';
import {
  Server,
  Layers,
  Shield,
  Database,
  Cpu,
  CheckCircle2,
  GitPullRequest,
} from 'lucide-react';
import type { ClusterSpecInfo } from '../../../lib/api/spec';
import type { SystemInfo } from '../../../lib/api/system';

interface DashboardMetricsProps {
  systemInfo?: SystemInfo | null;
  clusterSpec?: ClusterSpecInfo | null;
  isLoading?: boolean;
}

export function DashboardMetrics({
  systemInfo,
  clusterSpec,
  isLoading = false,
}: DashboardMetricsProps) {
  const shortHash = clusterSpec?.hash
    ? `${clusterSpec.hash.slice(0, 8)}...${clusterSpec.hash.slice(-6)}`
    : 'Baseline';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-sans">
      {/* KPI 1: Active Target Release */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">Cluster Spec Release</span>
            <div className="p-1.5 bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400 rounded-xs">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {clusterSpec?.releaseId ? `Release #${clusterSpec.releaseId}` : 'Initial Spec'}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
            <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-xs">
              {shortHash}
            </span>
            <span>declarative digest</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 transition-all duration-500 w-full" />
        </div>
      </div>

      {/* KPI 2: Data Plane Fleet Topology */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">Dataplane Architecture</span>
            <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xs">
              <Server className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            Stateless Fleet
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Autonomous agent pull over gRPC (:9090)</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-500 w-full" />
        </div>
      </div>

      {/* KPI 3: Control Plane Runtime */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">Control Plane Engine</span>
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
              <Shield className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {systemInfo?.uptime_formatted || 'Online'}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <span>{systemInfo?.product || 'Aurora API Gateway'} • {systemInfo?.go_version || 'Go'}</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-500 w-full" />
        </div>
      </div>

      {/* KPI 4: State & Storage Persistence */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-xs font-medium">State Persistence</span>
            <div className="p-1.5 bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400 rounded-xs">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-bold tabular-nums text-foreground">
            {systemInfo?.database_size_formatted || 'WAL Active'}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <span>{systemInfo?.state_persistence || 'SQLite WAL'} • {systemInfo?.memory_alloc_formatted || 'RAM OK'}</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-cyan-500 transition-all duration-500 w-full" />
        </div>
      </div>
    </div>
  );
}
