import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Crown } from 'lucide-react';

export function DashboardClusterHealth() {
  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col justify-between font-mono">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#152030]">
        <span className="text-sm font-semibold text-white">
          Cluster Health
        </span>
        <Link
          to="/nodes"
          className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
        >
          View Details
        </Link>
      </div>

      {/* Cluster Status Box */}
      <div className="my-3 p-3 bg-emerald-950/30 border border-emerald-500/40 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-xs font-bold text-emerald-400">Cluster Healthy</div>
          <div className="text-[11px] text-slate-300 font-sans mt-0.5">
            All controllers are online and in sync.
          </div>
        </div>
      </div>

      {/* Key-Value Details */}
      <div className="space-y-1.5 text-xs">
        <div className="flex justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Controllers</span>
          <span className="text-slate-200">3 / 3</span>
        </div>

        <div className="flex justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Leader</span>
          <span className="text-amber-400 flex items-center gap-1 font-semibold">
            <Crown className="w-3 h-3 inline" /> cp-01
          </span>
        </div>

        <div className="flex justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Raft Term</span>
          <span className="text-slate-200">24</span>
        </div>

        <div className="flex justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Last Election</span>
          <span className="text-slate-300">2026-08-25 10:14:32</span>
        </div>

        <div className="flex justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Nodes</span>
          <span className="text-slate-200">12 / 12</span>
        </div>

        <div className="flex justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Config Revision</span>
          <span className="text-cyan-400 font-semibold">v128</span>
        </div>

        <div className="flex justify-between py-1">
          <span className="text-slate-400">Last Sync</span>
          <span className="text-slate-300">2 minutes ago</span>
        </div>
      </div>
    </div>
  );
}
