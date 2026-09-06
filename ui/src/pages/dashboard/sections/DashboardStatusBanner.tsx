import React from 'react';
import { Info } from 'lucide-react';

export function DashboardStatusBanner() {
  return (
    <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 font-sans shadow-xs rounded-sm transition-colors">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 shrink-0 rounded-xs">
          <Info className="w-4 h-4" />
        </div>
        <div>
          <div className="text-xs font-bold text-slate-900 dark:text-white">
            All systems operational
          </div>
          <div className="text-[11px] text-slate-600 dark:text-slate-400 font-sans mt-0.5">
            Your NGINX WAF cluster is running smoothly. No critical alerts at this time.
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-slate-500 self-end sm:self-center">
        <span>Updated 1 minute ago</span>
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full bg-emerald-400 opacity-75 rounded-full"></span>
          <span className="relative inline-flex h-2 w-2 bg-emerald-500 rounded-full"></span>
        </span>
      </div>
    </div>
  );
}
