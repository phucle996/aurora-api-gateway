import React from 'react';
import { TrendingUp, ShieldCheck, Ban, Clock, ArrowDown } from 'lucide-react';

export function RateLimitsStats() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-sans">
      {/* Total Rules */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 hover:border-primary/30 shadow-sm transition-all">
        <div className="w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
          <TrendingUp className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider block">
            Total Rules
          </span>
          <div className="text-2xl font-bold text-foreground tracking-tight">
            18
          </div>
        </div>
      </div>

      {/* Active Rules */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 hover:border-primary/30 shadow-sm transition-all">
        <div className="w-10 h-10 bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider block">
            Active Rules
          </span>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight">
            15
          </div>
        </div>
      </div>

      {/* Blocked Requests */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 hover:border-primary/30 shadow-sm transition-all">
        <div className="w-10 h-10 bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive shrink-0">
          <Ban className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider block">
            Blocked Requests
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-destructive tracking-tight">
              12,513
            </span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center font-semibold">
              <ArrowDown className="w-2.5 h-2.5" /> 34%
            </span>
          </div>
        </div>
      </div>

      {/* Rate Limit Hits */}
      <div className="bg-card border border-border p-4 flex items-center gap-3.5 hover:border-primary/30 shadow-sm transition-all">
        <div className="w-10 h-10 bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider block">
            Rate Limit Hits
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground tracking-tight">
              28,421
            </span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center font-semibold">
              <ArrowDown className="w-2.5 h-2.5" /> 21%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
