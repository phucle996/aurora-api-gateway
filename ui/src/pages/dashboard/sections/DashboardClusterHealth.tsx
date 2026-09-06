import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';

export function DashboardClusterHealth() {
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
      <div className="my-3 p-3 bg-emerald-500/10 border border-emerald-500/30 flex items-start gap-3 rounded-sm">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Cluster Healthy</div>
          <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
            All controllers are online and in sync.
          </div>
        </div>
      </div>

      {/* Key-Value Details */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">HA Gateway</span>
          <span className="text-primary font-semibold">aurora-lb (:8090)</span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Control Plane</span>
          <span className="text-foreground font-semibold">Primary (:8080)</span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Data Plane Nodes</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">3 / 3 Ready</span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">State Persistence</span>
          <span className="text-foreground">SQLite (WAL Mode)</span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Telemetry Transport</span>
          <span className="text-foreground">Protobuf Binary Wire</span>
        </div>

        <div className="flex justify-between py-1 border-b border-border">
          <span className="text-muted-foreground">Policy Sync</span>
          <span className="text-primary font-semibold">In Sync</span>
        </div>

        <div className="flex justify-between py-1">
          <span className="text-muted-foreground">Heartbeat Interval</span>
          <span className="text-foreground">1s active</span>
        </div>
      </div>
    </div>
  );
}
