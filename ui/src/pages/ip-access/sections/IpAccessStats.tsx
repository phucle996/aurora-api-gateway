import React from 'react';
import { SlidersHorizontal, CheckCircle2, Ban, Clock } from 'lucide-react';

export function IpAccessStats() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {/* Total Rules */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 flex items-center gap-3.5 hover:border-[#223554] transition-all">
        <div className="w-10 h-10 bg-[#0E1B2C] border border-[#1C3252] flex items-center justify-center text-cyan-400 shrink-0">
          <SlidersHorizontal className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
            Total Rules
          </span>
          <div className="text-2xl font-bold text-white font-mono tracking-tight">
            126
          </div>
        </div>
      </div>

      {/* Allowlist */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 flex items-center gap-3.5 hover:border-[#223554] transition-all">
        <div className="w-10 h-10 bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-emerald-400 shrink-0">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
            Allowlist
          </span>
          <div className="text-2xl font-bold text-white font-mono tracking-tight text-emerald-400">
            24
          </div>
        </div>
      </div>

      {/* Blocklist */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 flex items-center gap-3.5 hover:border-[#223554] transition-all">
        <div className="w-10 h-10 bg-rose-950/60 border border-rose-800/60 flex items-center justify-center text-rose-400 shrink-0">
          <Ban className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
            Blocklist
          </span>
          <div className="text-2xl font-bold text-white font-mono tracking-tight text-rose-300">
            89
          </div>
        </div>
      </div>

      {/* Temporary Bans */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 flex items-center gap-3.5 hover:border-[#223554] transition-all">
        <div className="w-10 h-10 bg-amber-950/60 border border-amber-800/60 flex items-center justify-center text-amber-400 shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
            Temporary Bans
          </span>
          <div className="text-2xl font-bold text-white font-mono tracking-tight text-amber-300">
            13
          </div>
        </div>
      </div>
    </div>
  );
}
