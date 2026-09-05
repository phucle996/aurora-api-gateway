import React from 'react';
import {
  Server,
  Layers,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  FileCode2,
  Cpu,
  Clock,
  ShieldCheck,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

import type { NodeItem } from './NodesTable';

interface NodesStatsProps {
  nodes?: NodeItem[];
}

export function NodesStats({ nodes }: NodesStatsProps) {
  const registeredCount = nodes ? nodes.length : 0;
  const readyCount = nodes ? nodes.filter((n) => n.status === 'Ready').length : 0;
  const notReadyCount = nodes ? nodes.filter((n) => n.status !== 'Ready').length : 0;
  const ruleset = (nodes && nodes.length > 0 && nodes[0].ruleset) || '—';

  return (
    <div className="space-y-4">
      {/* Title & Description */}
      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight">
          Cluster / Nodes
        </h1>
        <p className="text-xs text-slate-400 font-mono mt-1">
          Monitor registered NGINX WAF nodes, controller health, ruleset sync, and cluster readiness. Nodes authenticate securely via mTLS certificates.
        </p>
      </div>

      {/* 6 Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Card 1: Controller Leader */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Controller Leader</span>
            <Server className="w-4 h-4 text-slate-500" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-white">cp-01</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">Primary Node</div>
          </div>
        </div>

        {/* Card 2: Controller Replicas */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Controller Replicas</span>
            <Layers className="w-4 h-4 text-slate-500" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-white">1</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">Local Primary</div>
          </div>
        </div>

        {/* Card 3: Registered Nodes */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Registered Nodes</span>
            <HardDrive className="w-4 h-4 text-slate-500" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-white">{registeredCount}</div>
            <div className="text-[10px] font-mono text-emerald-400 flex items-center gap-0.5 mt-0.5">
              <span>Active in Cluster</span>
            </div>
          </div>
        </div>

        {/* Card 4: Ready Nodes */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Ready Nodes</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-emerald-400">{readyCount}</div>
            <div className="text-[10px] font-mono text-emerald-400 flex items-center gap-0.5 mt-0.5">
              <span>Online & Protecting</span>
            </div>
          </div>
        </div>

        {/* Card 5: Not Ready */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Not Ready</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-rose-400">{notReadyCount}</div>
            <div className="text-[10px] font-mono text-rose-400 flex items-center gap-0.5 mt-0.5">
              <span>{notReadyCount === 0 ? 'Healthy' : 'Requires Attention'}</span>
            </div>
          </div>
        </div>

        {/* Card 6: Ruleset Revision */}
        <div className="bg-[#0B1320] border border-[#152030] p-3.5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-mono text-slate-400">Ruleset Revision</span>
            <FileCode2 className="w-4 h-4 text-slate-500" />
          </div>
          <div>
            <div className="text-lg font-bold font-mono text-cyan-400">{ruleset}</div>
            <div className="text-[10px] font-mono text-slate-500 mt-0.5">Active Release</div>
          </div>
        </div>
      </div>

      {/* Cluster Status Ribbon */}
      <div className="bg-[#0B1320] border border-[#152030] px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
        <div className="flex items-center gap-6 flex-wrap">
          {/* Consensus */}
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-slate-400">Consensus:</span>
            <span className="text-emerald-400 font-semibold">Healthy</span>
          </div>

          {/* Cluster Mode */}
          <div className="flex items-center gap-2 border-l border-[#1C293D] pl-6">
            <Cpu className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Cluster Mode:</span>
            <span className="text-slate-200">Raft</span>
          </div>

          {/* Last Policy Publish */}
          <div className="flex items-center gap-2 border-l border-[#1C293D] pl-6">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-400">Last Policy Publish:</span>
            <span className="text-slate-200">2026-09-05 08:41 UTC</span>
          </div>
        </div>

        {/* Auto Join */}
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-400">Auto Join:</span>
          <span className="text-cyan-400 font-semibold">Enabled</span>
        </div>
      </div>
    </div>
  );
}
