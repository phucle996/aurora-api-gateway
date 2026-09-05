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
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {/* Card 1: Total Requests */}
      <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono">Total Requests</span>
            <div className="p-1.5 bg-blue-950/40 border border-blue-500/30 text-blue-400">
              <Globe className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-mono text-white">12.4M</div>
          <div className="text-[10px] font-mono text-emerald-400 flex items-center gap-0.5 mt-0.5">
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
              stroke="#38bdf8"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Card 2: Blocked Requests */}
      <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono">Blocked Requests</span>
            <div className="p-1.5 bg-rose-950/40 border border-rose-500/30 text-rose-400">
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-mono text-white">342.1K</div>
          <div className="text-[10px] font-mono text-rose-400 flex items-center gap-0.5 mt-0.5">
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
              stroke="#f43f5e"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Card 3: Block Rate */}
      <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono">Block Rate</span>
            <div className="p-1.5 bg-cyan-950/40 border border-cyan-500/30 text-cyan-400">
              <Percent className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-mono text-white">2.76%</div>
          <div className="text-[10px] font-mono text-cyan-400 flex items-center gap-0.5 mt-0.5">
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
              stroke="#06b6d4"
              strokeWidth="2"
            />
          </svg>
        </div>
      </div>

      {/* Card 4: Active Policies */}
      <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono">Active Policies</span>
            <div className="p-1.5 bg-slate-800 border border-slate-700 text-slate-300">
              <FileCode className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-mono text-white">18</div>
          <div className="text-[10px] font-mono text-slate-500 flex items-center gap-0.5 mt-0.5">
            <ArrowRight className="w-3 h-3 inline" />
            <span>0%</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-[#152030] mt-3">
          <div className="h-full bg-slate-400 w-full" />
        </div>
      </div>

      {/* Card 5: NGINX Nodes */}
      <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono">NGINX Nodes</span>
            <div className="p-1.5 bg-emerald-950/40 border border-emerald-500/30 text-emerald-400">
              <Server className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400">12 / 12</div>
          <div className="text-[10px] font-mono text-emerald-400 mt-0.5">Online</div>
        </div>
        <div className="h-1.5 w-full bg-[#152030] mt-3">
          <div className="h-full bg-emerald-500 w-full" />
        </div>
      </div>

      {/* Card 6: Cluster Mode */}
      <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono">Cluster Topology</span>
            <div className="p-1.5 bg-indigo-950/40 border border-indigo-500/30 text-indigo-400">
              <Boxes className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm font-bold font-mono text-white">HA NGINX Cluster</div>
          <div className="text-[10px] font-mono text-emerald-400 flex items-center gap-1 mt-1">
            <span className="w-1.5 h-1.5 bg-emerald-400 inline-block" />
            <span>LB: aurora-lb (:8090)</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-[#152030] mt-3">
          <div className="h-full bg-indigo-500 w-full" />
        </div>
      </div>
    </div>
  );
}
