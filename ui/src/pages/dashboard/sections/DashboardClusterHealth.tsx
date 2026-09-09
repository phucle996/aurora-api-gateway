import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { systemApi, type SystemInfo } from '../../../lib/api/system';

export function DashboardClusterHealth() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    systemApi.getInfo().then(setInfo).catch(() => {});
  }, []);

  const nodesReady = info?.nodes_ready ?? 0;
  const nodesTotal = info?.nodes_total ?? 0;
  const isHealthy = nodesTotal === 0 || nodesReady === nodesTotal;

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between font-sans shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">
          Cluster Health
        </span>
        <Link
          to="/nodes"
          className="text-xs text-primary hover:underline transition-colors"
        >
          View Details
        </Link>
      </div>

      {/* Cluster Status Box */}
      <div className={`my-3 p-3 flex items-start gap-3 rounded-sm ${isHealthy ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-amber-500/10 border border-amber-500/30'}`}>
        {isHealthy ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        )}
        <div>
          <div className={`text-xs font-bold ${isHealthy ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
            {nodesTotal === 0 ? 'Control Plane Active' : isHealthy ? 'Cluster Healthy' : 'Cluster Degraded'}
          </div>
          <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
            {nodesTotal === 0
              ? 'Awaiting data plane nodes to connect.'
              : `${nodesReady} of ${nodesTotal} nodes in sync.`}
          </div>
        </div>
      </div>

      {/* Key-Value Details */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Control Plane</span>
          <span className="text-foreground font-semibold">
            {info?.product || 'Aurora WAF'} ({info?.version || '0.4.2'})
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Data Plane Nodes</span>
          <span className="text-foreground font-semibold">
            {nodesReady} / {nodesTotal} Ready
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">State Persistence</span>
          <span className="text-foreground">{info?.state_persistence || 'SQLite (WAL Mode)'}</span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Architecture</span>
          <span className="text-foreground">{info?.architecture || 'x86_64'}</span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Uptime</span>
          <span className="text-primary font-semibold">{info?.uptime_formatted || 'Online'}</span>
        </div>

        <div className="flex justify-between py-1">
          <span className="text-muted-foreground">Go Version</span>
          <span className="text-foreground">{info?.go_version || 'go1.24'}</span>
        </div>
      </div>
    </div>
  );
}

