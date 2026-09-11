import React from 'react';
import { RefreshCw, Radio, Hash, Layers } from 'lucide-react';
import type { ClusterSpecInfo } from '../../../lib/api/spec';

interface DashboardHeaderProps {
  clusterSpec?: ClusterSpecInfo | null;
  streamState?: 'Live' | 'Polling' | 'Disconnected';
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function DashboardHeader({
  clusterSpec,
  streamState = 'Live',
  onRefresh,
  isRefreshing = false,
}: DashboardHeaderProps) {
  const shortHash = clusterSpec?.hash
    ? `${clusterSpec.hash.slice(0, 8)}...${clusterSpec.hash.slice(-4)}`
    : null;

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-1">
      <div>
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            System Operations & Capacity
          </h1>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-xs text-[11px] font-mono font-medium border bg-muted/60 text-muted-foreground border-border">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                streamState === 'Live'
                  ? 'bg-emerald-500 animate-pulse'
                  : streamState === 'Polling'
                  ? 'bg-amber-500'
                  : 'bg-destructive'
              }`}
            />
            {streamState === 'Live' ? 'Telemetry Live' : streamState}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1 font-sans">
          Real-time processing throughput, resource pressure, and pull-based declarative spec synchronization.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5 font-sans">
        {/* Cluster Active Spec Badge */}
        {clusterSpec?.hasSpec ? (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card border border-border text-xs text-foreground shadow-xs rounded-sm"
            title={`Active Release #${clusterSpec.releaseId} • SHA-256: ${clusterSpec.hash}`}
          >
            <Layers className="w-3.5 h-3.5 text-primary" />
            <span className="text-muted-foreground text-[11px]">Active Spec:</span>
            <span className="font-semibold text-[11px] text-foreground font-mono">
              r{clusterSpec.releaseId}
            </span>
            <span className="text-muted-foreground font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded-xs flex items-center gap-0.5">
              <Hash className="w-2.5 h-2.5" />
              {shortHash}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card border border-border text-xs text-muted-foreground shadow-xs rounded-sm">
            <Layers className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px]">Spec: Default Baseline</span>
          </div>
        )}

        {/* Refresh Button */}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-card hover:bg-muted border border-border text-xs font-medium text-foreground rounded-sm shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh metrics & sync states"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </div>
  );
}
