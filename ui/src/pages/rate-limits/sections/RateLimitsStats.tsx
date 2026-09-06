import React from 'react';
import { TrendingUp, ShieldCheck, Ban, Clock, ArrowDown } from 'lucide-react';

export function RateLimitsStats() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-sans">
      {/* Total Rules */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 flex items-center gap-3.5 hover:border-slate-300 dark:hover:border-[#223554] shadow-sm dark:shadow-none transition-all">
        <div className="w-10 h-10 bg-cyan-50 dark:bg-[#0E1B2C] border border-cyan-200 dark:border-[#1C3252] flex items-center justify-center text-cyan-600 dark:text-cyan-400 shrink-0">
          <TrendingUp className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            Total Rules
          </span>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            18
          </div>
        </div>
      </div>

      {/* Active Rules */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 flex items-center gap-3.5 hover:border-slate-300 dark:hover:border-[#223554] shadow-sm dark:shadow-none transition-all">
        <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            Active Rules
          </span>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tracking-tight">
            15
          </div>
        </div>
      </div>

      {/* Blocked Requests */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 flex items-center gap-3.5 hover:border-slate-300 dark:hover:border-[#223554] shadow-sm dark:shadow-none transition-all">
        <div className="w-10 h-10 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/60 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
          <Ban className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            Blocked Requests
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-rose-600 dark:text-rose-300 tracking-tight">
              12,513
            </span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center font-semibold">
              <ArrowDown className="w-2.5 h-2.5" /> 34%
            </span>
          </div>
        </div>
      </div>

      {/* Rate Limit Hits */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 flex items-center gap-3.5 hover:border-slate-300 dark:hover:border-[#223554] shadow-sm dark:shadow-none transition-all">
        <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
            Rate Limit Hits
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-300 tracking-tight">
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
