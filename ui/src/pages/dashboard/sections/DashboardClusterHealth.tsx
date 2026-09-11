import React from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  AlertCircle,
  Shield,
  Database,
  Cpu,
  Clock,
  ExternalLink,
} from 'lucide-react';
import type { SystemInfo } from '../../../lib/api/system';
import type { NodeRecord } from '../../../lib/api/nodes';

interface DashboardClusterHealthProps {
  systemInfo: SystemInfo | null;
  nodes: NodeRecord[];
}

export function DashboardClusterHealth({
  systemInfo,
  nodes,
}: DashboardClusterHealthProps) {
  const nodesReady = nodes.filter((n) => n.status === 'Ready').length;
  const nodesTotal = nodes.length;
  const isHealthy = nodesTotal > 0 && nodesReady === nodesTotal;

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between font-sans shadow-xs rounded-sm transition-colors h-full">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
              <Shield className="w-3.5 h-3.5" />
            </div>
            <span className="text-sm font-semibold text-foreground">
              Control Plane & Storage Health
            </span>
          </div>
          <Link
            to="/settings"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            <span>Settings</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </Link>
        </div>

        {/* Cluster Status Box */}
        <div
          className={`my-3 p-3 flex items-start gap-3 rounded-sm ${
            isHealthy
              ? 'bg-emerald-500/10 border border-emerald-500/30'
              : nodesTotal === 0
              ? 'bg-blue-500/10 border border-blue-500/30'
              : 'bg-amber-500/10 border border-amber-500/30'
          }`}
        >
          {isHealthy ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          ) : nodesTotal === 0 ? (
            <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          )}
          <div>
            <div
              className={`text-xs font-bold ${
                isHealthy
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : nodesTotal === 0
                  ? 'text-blue-700 dark:text-blue-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {nodesTotal === 0
                ? 'Control Plane Online (Standalone)'
                : isHealthy
                ? 'Cluster Fully Operational'
                : 'Cluster Degraded'}
            </div>
            <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
              {nodesTotal === 0
                ? 'Control plane is active and listening for data plane join requests.'
                : `${nodesReady} of ${nodesTotal} data plane node${
                    nodesTotal > 1 ? 's' : ''
                  } healthy.`}
            </div>
          </div>
        </div>

        {/* Operational Key-Value Pairs */}
        <div className="space-y-2 text-xs">
          <div className="flex justify-between py-1 border-b border-border">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Shield className="w-3 h-3 text-muted-foreground" />
              Product Engine
            </span>
            <span className="text-foreground font-semibold">
              {systemInfo?.product || 'Aurora API Gateway'} ({systemInfo?.version || 'v0.4.2'})
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-border">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Database className="w-3 h-3 text-muted-foreground" />
              State Persistence
            </span>
            <span className="text-foreground font-mono">
              {systemInfo?.state_persistence || 'SQLite WAL Mode'}
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-border">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Database className="w-3 h-3 text-muted-foreground" />
              Database Size
            </span>
            <span className="text-foreground font-mono">
              {systemInfo?.database_size_formatted || '0 MB'}
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-border">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Cpu className="w-3 h-3 text-muted-foreground" />
              CP Memory Alloc
            </span>
            <span className="text-foreground font-mono">
              {systemInfo?.memory_alloc_formatted || '0 MB'} ({systemInfo?.architecture || 'amd64'})
            </span>
          </div>

          <div className="flex justify-between py-1 border-b border-border">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-muted-foreground" />
              Uptime
            </span>
            <span className="text-primary font-semibold">
              {systemInfo?.uptime_formatted || 'Online'}
            </span>
          </div>

          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">Runtime Runtime</span>
            <span className="text-muted-foreground font-mono">
              {systemInfo?.go_version || 'Go'}
            </span>
          </div>
        </div>
      </div>

      {/* Footer link */}
      <div className="pt-3 mt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <span>WAL Passive Checkpoint: Active</span>
        <Link to="/settings" className="text-primary hover:underline">
          Backup Snapshots
        </Link>
      </div>
    </div>
  );
}
