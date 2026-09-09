import React from 'react';
import { ExtensionStatsData } from '../types';
import { Blocks, CheckCircle2, Shield, Activity, Cpu, ArrowLeftRight, Lock } from 'lucide-react';

interface ExtensionStatsProps {
  stats: ExtensionStatsData;
}

export function ExtensionStats({ stats }: ExtensionStatsProps) {
  const activePercent = stats.total > 0 ? Math.round((stats.enabled / stats.total) * 100) : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {/* 1. Total Extensions */}
      <div className="bg-card/70 backdrop-blur-xs border border-border/70 rounded-md p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Total Catalog
          </span>
          <div className="p-1.5 rounded-sm bg-primary/10 text-primary">
            <Blocks className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-foreground">{stats.total}</span>
          <span className="text-xs text-muted-foreground">extensions</span>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          Synchronized to NodeSpec
        </div>
      </div>

      {/* 2. Active / Enabled */}
      <div className="bg-card/70 backdrop-blur-xs border border-border/70 rounded-md p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Active / Enabled
          </span>
          <div className="p-1.5 rounded-sm bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.enabled}
          </span>
          <span className="text-xs text-muted-foreground">({activePercent}% active)</span>
        </div>
        <div className="mt-2 w-full bg-muted/60 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${activePercent}%` }}
          />
        </div>
      </div>

      {/* 3. Inactive / Standby */}
      <div className="bg-card/70 backdrop-blur-xs border border-border/70 rounded-md p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Available / Standby
          </span>
          <div className="p-1.5 rounded-sm bg-muted text-muted-foreground">
            <Blocks className="w-4 h-4 opacity-70" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-muted-foreground">
            {stats.disabled}
          </span>
          <span className="text-xs text-muted-foreground">ready to toggle</span>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground/80">
          Zero-overhead dormant state
        </div>
      </div>

      {/* 4. Category Breakdown */}
      <div className="bg-card/70 backdrop-blur-xs border border-border/70 rounded-md p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Ecosystem Breakdown
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium">
            <Shield className="w-3 h-3" />
            Sec: {stats.byCategory.security || 0}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-medium">
            <Activity className="w-3 h-3" />
            Obs: {stats.byCategory.observability || 0}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
            <ArrowLeftRight className="w-3 h-3" />
            Traffic: {stats.byCategory.traffic || 0}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium">
            <Lock className="w-3 h-3" />
            Auth: {stats.byCategory.auth || 0}
          </span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 font-medium">
            <Cpu className="w-3 h-3" />
            Runtime: {stats.byCategory.runtime || 0}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground/80">
          Integrated directly into NGINX WAF
        </div>
      </div>
    </div>
  );
}
