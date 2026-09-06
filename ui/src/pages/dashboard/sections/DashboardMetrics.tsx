import React from 'react';
import {
  Globe,
  ShieldAlert,
  Percent,
  FileCode,
  Server,
  Boxes,
  ArrowUpRight,
  ArrowRight,
} from 'lucide-react';

export function DashboardMetrics() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 font-sans">
      {/* Card 1: Total Requests */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-sans font-medium">Total Requests</span>
            <div className="p-1.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 rounded-xs">
              <Globe className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-slate-900 dark:text-white">12.4M</div>
          <div className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-3 h-3 inline" />
            <span>12%</span>
          </div>
        </div>
        {/* Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <path
              d="M0,20 Q15,15 30,18 T60,8 T80,14 T100,5"
              fill="none"
              stroke="#0284c7"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Card 2: Blocked Requests */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-sans font-medium">Blocked Requests</span>
            <div className="p-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 rounded-xs">
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-slate-900 dark:text-white">342.1K</div>
          <div className="text-[10px] font-sans text-rose-600 dark:text-rose-400 flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-3 h-3 inline" />
            <span>28%</span>
          </div>
        </div>
        {/* Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <path
              d="M0,22 Q20,18 40,20 T70,12 T90,6 T100,4"
              fill="none"
              stroke="#e11d48"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Card 3: Block Rate */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-sans font-medium">Block Rate</span>
            <div className="p-1.5 bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-200 dark:border-cyan-500/30 text-cyan-700 dark:text-cyan-400 rounded-xs">
              <Percent className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-slate-900 dark:text-white">2.76%</div>
          <div className="text-[10px] font-sans text-cyan-600 dark:text-cyan-400 flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-3 h-3 inline" />
            <span>0.4%</span>
          </div>
        </div>
        {/* Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <path
              d="M0,18 Q25,12 50,15 T75,10 T100,12"
              fill="none"
              stroke="#0891b2"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Card 4: Active Policies */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-sans font-medium">Active Policies</span>
            <div className="p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xs">
              <FileCode className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-slate-900 dark:text-white">18</div>
          <div className="text-[10px] font-sans text-slate-500 flex items-center gap-0.5 mt-0.5">
            <ArrowRight className="w-3 h-3 inline" />
            <span>0%</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-slate-100 dark:bg-[#152030] mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-slate-400 w-full" />
        </div>
      </div>

      {/* Card 5: NGINX Nodes */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-sans font-medium">NGINX Nodes</span>
            <div className="p-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-xs">
              <Server className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-emerald-600 dark:text-emerald-400">12 / 12</div>
          <div className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 mt-0.5">Online</div>
        </div>
        <div className="h-1.5 w-full bg-slate-100 dark:bg-[#152030] mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 w-full" />
        </div>
      </div>

      {/* Card 6: Cluster Mode */}
      <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-[11px] font-sans font-medium">Cluster Topology</span>
            <div className="p-1.5 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400 rounded-xs">
              <Boxes className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm font-bold font-sans text-slate-900 dark:text-white">HA NGINX Cluster</div>
          <div className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" />
            <span>LB: aurora-lb (:8090)</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-slate-100 dark:bg-[#152030] mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 w-full" />
        </div>
      </div>
    </div>
  );
}
