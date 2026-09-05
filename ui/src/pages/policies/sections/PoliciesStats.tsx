import React from 'react';
import { Layers, ShieldCheck, Eye, ShieldAlert, ArrowUp, Minus } from 'lucide-react';

export function PoliciesStats() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {/* Total Policies */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Total Policies
          </span>
          <Layers className="w-4 h-4 text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5">
          6
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+2 vs. last month</span>
        </div>
      </div>

      {/* Active Enforcement */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Active Enforcement
          </span>
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5 text-emerald-400">
          4
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+1 vs. last month</span>
        </div>
      </div>

      {/* Observation Mode */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Observation Mode
          </span>
          <Eye className="w-4 h-4 text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5">
          1
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-400 font-mono">
          <Minus className="w-3.5 h-3.5" />
          <span>No change</span>
        </div>
      </div>

      {/* Draft / Inactive */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Draft / Inactive
          </span>
          <ShieldAlert className="w-4 h-4 text-amber-400" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5 text-amber-300">
          1
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-slate-400 font-mono">
          <Minus className="w-3.5 h-3.5" />
          <span>No change</span>
        </div>
      </div>
    </div>
  );
}
