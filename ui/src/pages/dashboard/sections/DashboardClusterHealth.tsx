import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Crown } from 'lucide-react';

export function DashboardClusterHealth() {
  return (
    <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 flex flex-col justify-between font-sans shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#152030]">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          Cluster Health
        </span>
        <Link
          to="/nodes"
          className="text-xs text-blue-600 dark:text-cyan-400 hover:underline transition-colors"
        >
          View Details
        </Link>
      </div>

      {/* Cluster Status Box */}
      <div className="my-3 p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-500/40 flex items-start gap-3 rounded-sm">
        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Cluster Healthy</div>
          <div className="text-[11px] text-slate-600 dark:text-slate-300 font-sans mt-0.5">
            All controllers are online and in sync.
          </div>
        </div>
      </div>

      {/* Key-Value Details */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#152030]/50">
          <span className="text-slate-500 dark:text-slate-400">HA Gateway</span>
          <span className="text-blue-600 dark:text-cyan-400 font-semibold">aurora-lb (:8090)</span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#152030]/50">
          <span className="text-slate-500 dark:text-slate-400">Control Plane</span>
          <span className="text-slate-800 dark:text-slate-200 font-semibold">Primary (:8080)</span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#152030]/50">
          <span className="text-slate-500 dark:text-slate-400">Data Plane Nodes</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">3 / 3 Ready</span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#152030]/50">
          <span className="text-slate-500 dark:text-slate-400">State Persistence</span>
          <span className="text-slate-700 dark:text-slate-300">SQLite (WAL Mode)</span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#152030]/50">
          <span className="text-slate-500 dark:text-slate-400">Telemetry Transport</span>
          <span className="text-slate-800 dark:text-slate-200">Protobuf Binary Wire</span>
        </div>

        <div className="flex justify-between py-1 border-b border-slate-100 dark:border-[#152030]/50">
          <span className="text-slate-500 dark:text-slate-400">Policy Sync</span>
          <span className="text-blue-600 dark:text-cyan-400 font-semibold">In Sync</span>
        </div>

        <div className="flex justify-between py-1">
          <span className="text-slate-500 dark:text-slate-400">Heartbeat Interval</span>
          <span className="text-slate-700 dark:text-slate-300">1s active</span>
        </div>
      </div>
    </div>
  );
}
