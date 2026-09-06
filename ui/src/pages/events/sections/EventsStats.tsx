import React from 'react';
import { FileText, Shield, Eye, AlertTriangle, ArrowUp } from 'lucide-react';

export function EventsStats() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-sans">
      {/* Total Events */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 hover:border-slate-300 dark:hover:border-[#223554] shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Total Events
          </span>
          <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white font-sans tabular-nums tracking-tight mt-1.5">
          18.4K
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-sans">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+12% vs. last 24h</span>
        </div>
      </div>

      {/* Blocked Requests */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 hover:border-slate-300 dark:hover:border-[#223554] shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Blocked Requests
          </span>
          <Shield className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white font-sans tabular-nums tracking-tight mt-1.5">
          2.1K
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-sans">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+8% vs. last 24h</span>
        </div>
      </div>

      {/* Logged Events */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 hover:border-slate-300 dark:hover:border-[#223554] shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Logged Events
          </span>
          <Eye className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white font-sans tabular-nums tracking-tight mt-1.5">
          14.8K
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-sans">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+15% vs. last 24h</span>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 hover:border-slate-300 dark:hover:border-[#223554] shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Critical Alerts
          </span>
          <AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400" />
        </div>
        <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 font-sans tabular-nums tracking-tight mt-1.5">
          127
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-sans">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+3% vs. last 24h</span>
        </div>
      </div>
    </div>
  );
}
