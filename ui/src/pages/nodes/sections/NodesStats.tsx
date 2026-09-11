import React from 'react';
import {
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  FileCode2,
  RefreshCw,
} from 'lucide-react';

import type { NodeItem } from './NodesTable';

interface NodesStatsProps {
  nodes?: NodeItem[];
}

export function NodesStats({ nodes }: NodesStatsProps) {
  const registeredCount = nodes ? nodes.length : 0;
  const readyCount = nodes ? nodes.filter((n) => n.status === 'Ready').length : 0;
  const notReadyCount = nodes ? nodes.filter((n) => n.status !== 'Ready').length : 0;
  const inSyncCount = nodes ? nodes.filter((n) => n.sync === 'In Sync' && n.status === 'Ready').length : 0;
  const revisions = new Set(nodes?.map(n => n.ruleset));
  const ruleset = revisions.size > 1 ? 'Mixed' : [...revisions][0] || 'Unknown';

  return (
    <div className="space-y-4">
      {/* Title & Description */}
      <div>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          Cluster / Nodes
        </h1>
        <p className="text-xs text-muted-foreground mt-1">
          Monitor registered NGINX data plane nodes, operational health, and ruleset synchronization.
        </p>
      </div>

      {/* Dynamic Stats Grid - 100% Real Data from Nodes API */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Card 1: Registered Nodes */}
        <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium text-muted-foreground">Total Nodes</span>
            <HardDrive className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-foreground">{registeredCount}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              <span>Registered in Cluster</span>
            </div>
          </div>
        </div>

        {/* Card 2: Ready Nodes */}
        <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium text-muted-foreground">Ready Nodes</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-emerald-500">{readyCount}</div>
            <div className="text-[10px] text-emerald-500 mt-0.5">
              <span>Recent heartbeat</span>
            </div>
          </div>
        </div>

        {/* Card 3: Not Ready */}
        <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium text-muted-foreground">Not Ready</span>
            <AlertTriangle className={`w-4 h-4 ${notReadyCount > 0 ? 'text-rose-500' : 'text-muted-foreground'}`} />
          </div>
          <div>
            <div className={`text-lg font-bold tabular-nums ${notReadyCount > 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>
              {notReadyCount}
            </div>
            <div className={`text-[10px] mt-0.5 ${notReadyCount > 0 ? 'text-rose-500' : 'text-muted-foreground'}`}>
              <span>{notReadyCount === 0 ? 'No stale heartbeats' : 'Requires Attention'}</span>
            </div>
          </div>
        </div>

        {/* Card 4: Policy Synchronization */}
        <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium text-muted-foreground">Policy Sync</span>
            <RefreshCw className="w-4 h-4 text-cyan-500" />
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-foreground">
              {registeredCount > 0 ? `${inSyncCount}/${registeredCount}` : '—'}
            </div>
            <div className="text-[10px] text-cyan-500 mt-0.5">
              <span>{inSyncCount === registeredCount && registeredCount > 0 ? 'Synchronized' : 'Not fully confirmed'}</span>
            </div>
          </div>
        </div>

        {/* Card 5: Ruleset Revision */}
        <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-medium text-muted-foreground">Ruleset Revision</span>
            <FileCode2 className="w-4 h-4 text-indigo-500" />
          </div>
          <div>
            <div className="text-lg font-bold text-indigo-500">{ruleset}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Observed runtime release</div>
          </div>
        </div>
      </div>
    </div>
  );
}
