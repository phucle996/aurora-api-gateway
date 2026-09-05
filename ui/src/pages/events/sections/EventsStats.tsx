import React from 'react';
import { FileText, Shield, Eye, AlertTriangle, ArrowUp } from 'lucide-react';

export function EventsStats() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {/* Total Events */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Total Events
          </span>
          <FileText className="w-4 h-4 text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5">
          18.4K
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+12% vs. last 24h</span>
        </div>
      </div>

      {/* Blocked Requests */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Blocked Requests
          </span>
          <Shield className="w-4 h-4 text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5">
          2.1K
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+8% vs. last 24h</span>
        </div>
      </div>

      {/* Logged Events */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Logged Events
          </span>
          <Eye className="w-4 h-4 text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5">
          14.8K
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+15% vs. last 24h</span>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="bg-[#0B1320] border border-[#172338] p-4 hover:border-[#223554] transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Critical Alerts
          </span>
          <AlertTriangle className="w-4 h-4 text-rose-400" />
        </div>
        <div className="text-2xl font-bold text-white font-mono tracking-tight mt-1.5 text-rose-300">
          127
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
          <ArrowUp className="w-3.5 h-3.5" />
          <span>+3% vs. last 24h</span>
        </div>
      </div>
    </div>
  );
}
