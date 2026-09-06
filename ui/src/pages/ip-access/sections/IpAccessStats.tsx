import React from 'react';
import { SlidersHorizontal, CheckCircle2, Ban, Clock } from 'lucide-react';

export function IpAccessStats() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-sans">
      {/* Total Rules */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 shadow-xs rounded-sm transition-all">
        <div className="w-10 h-10 bg-cyan-50 dark:bg-[#0E1B2C] border border-cyan-200 dark:border-[#1C3252] flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0 rounded-xs">
          <SlidersHorizontal className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider block">
            Total Rules
          </span>
          <div className="text-2xl font-bold text-foreground font-sans tabular-nums tracking-tight">
            126
          </div>
        </div>
      </div>

      {/* Allowlist */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 shadow-xs rounded-sm transition-all">
        <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 rounded-xs">
          <CheckCircle2 className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider block">
            Allowlist
          </span>
          <div className="text-2xl font-bold font-sans tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
            24
          </div>
        </div>
      </div>

      {/* Blocklist */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 shadow-xs rounded-sm transition-all">
        <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0 rounded-xs">
          <Ban className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider block">
            Blocklist
          </span>
          <div className="text-2xl font-bold font-sans tabular-nums tracking-tight text-rose-600 dark:text-rose-400">
            89
          </div>
        </div>
      </div>

      {/* Temporary Bans */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 shadow-xs rounded-sm transition-all">
        <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/60 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 rounded-xs">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] font-sans font-medium text-muted-foreground uppercase tracking-wider block">
            Temporary Bans
          </span>
          <div className="text-2xl font-bold font-sans tabular-nums tracking-tight text-amber-600 dark:text-amber-400">
            13
          </div>
        </div>
      </div>
    </div>
  );
}
