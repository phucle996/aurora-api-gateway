import React from 'react';
import {
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  FileCode2,
  RefreshCw,
  Activity,
} from 'lucide-react';

import type { NodeItem } from './NodesTable';

interface NodesStatsProps {
  nodes?: NodeItem[];
}

export function NodesStats({ nodes }: NodesStatsProps) {
  const registeredCount = nodes ? nodes.length : 0;
  const readyCount = nodes ? nodes.filter((n) => n.status === 'Ready').length : 0;
  const notReadyCount = nodes ? nodes.filter((n) => n.status !== 'Ready').length : 0;
  const inSyncCount = nodes ? nodes.filter((n) => n.sync === 'In Sync').length : 0;
  const ruleset = (nodes && nodes.length > 0 && nodes[0].ruleset) || 'None';

  const totalRps = nodes
    ? nodes.reduce((acc, n) => acc + (parseFloat(n.requestsPerSecond) || 0), 0).toFixed(1)
    : '0.0';

  const totalConns = nodes
    ? nodes.reduce((acc, n) => acc + (parseInt(n.activeConnections, 10) || 0), 0)
    : 0;

  return (
    <div className="space-y-4">
      {/* Title & Description */}
      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight">
          Cluster / Nodes
        </h1>
        <p className="text-xs text-slate-400 font-mono mt-1">
          Monitor registered NGINX WAF nodes, health status, ruleset sync, and live traffic metrics.
        </p>
      </div>

      {/* Dynamic Stats Grid - 100% Real Data from Nodes API */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Registered Nodes */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Total Nodes</span>
            <HardDrive className="w-4 h-4 text-slate-500" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-white">{registeredCount}</div>
            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
              <span>Registered in Cluster</span>
            </div>
          </div>
        </div>

        {/* Card 2: Ready Nodes */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Ready Nodes</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-emerald-400">{readyCount}</div>
            <div className="text-[10px] font-mono text-emerald-400 mt-0.5">
              <span>Online & Protecting</span>
            </div>
          </div>
        </div>

        {/* Card 3: Not Ready */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Not Ready</span>
            <AlertTriangle className={`w-4 h-4 ${notReadyCount > 0 ? 'text-rose-400' : 'text-slate-500'}`} />
          </div>
          <div>
            <div className={`text-lg font-bold font-mono ${notReadyCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>
              {notReadyCount}
            </div>
            <div className={`text-[10px] font-mono mt-0.5 ${notReadyCount > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
              <span>{notReadyCount === 0 ? 'All Nodes Healthy' : 'Requires Attention'}</span>
            </div>
          </div>
        </div>

        {/* Card 4: Policy Synchronization */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Policy Sync</span>
            <RefreshCw className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-white">
              {registeredCount > 0 ? `${inSyncCount}/${registeredCount}` : '—'}
            </div>
            <div className="text-[10px] font-mono text-cyan-400 mt-0.5">
              <span>{inSyncCount === registeredCount && registeredCount > 0 ? 'Synchronized' : 'Sync In Progress'}</span>
            </div>
          </div>
        </div>

        {/* Card 5: Throughput & Connections */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Cluster Load</span>
            <Activity className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-white">{totalRps} RPS</div>
            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
              <span>{totalConns} active connections</span>
            </div>
          </div>
        </div>

        {/* Card 6: Ruleset Revision */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Ruleset Revision</span>
            <FileCode2 className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-indigo-400">{ruleset}</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">Active Release</div>
          </div>
        </div>
      </div>
    </div>
  );
}

