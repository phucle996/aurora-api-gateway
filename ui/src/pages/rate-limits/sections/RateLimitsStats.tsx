import React from 'react';
import {
  Sliders,
  TrendingUp,
  Ban,
  Activity,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  HardDrive,
} from 'lucide-react';

import { RateLimitStats as RateLimitStatsType } from '../../../lib/api/rate-limits';

interface RateLimitsStatsProps {
  totalRules?: number;
  activeRules?: number;
  blockedCount?: number;
  totalHits?: number;
  stats?: RateLimitStatsType | null;
  loading?: boolean;
}

export function RateLimitsStats({
  totalRules = 0,
  activeRules = 0,
  blockedCount: manualBlocked,
  totalHits: manualHits,
  stats,
  loading = false,
}: RateLimitsStatsProps) {
  const totalHits = stats ? stats.total_hits : (manualHits ?? 0);
  const blockedCount = stats ? stats.total_blocked : (manualBlocked ?? 0);
  const throttledCount = stats ? stats.total_throttled : Math.max(0, totalHits - blockedCount);
  const avgLatency = stats ? stats.avg_latency_ms : 0.28;
  const isDisabled = stats?.mode === 'disabled' || stats?.enabled === false;

  const hitsChange = stats ? stats.hits_change_pct : 0;
  const blockedChange = stats ? stats.blocked_change_pct : 0;

  const inactiveRules = Math.max(0, totalRules - activeRules);
  const activePercent = totalRules > 0 ? Math.round((activeRules / totalRules) * 100) : 0;
  const blockRatio = totalHits > 0 ? Math.round((blockedCount / totalHits) * 100) : 0;

  const formatPct = (val: number) => {
    const formatted = Math.abs(val).toFixed(1);
    if (val > 0) return `+${formatted}%`;
    if (val < 0) return `-${formatted}%`;
    return '0.0%';
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-sans">
      {/* 1. Rule Coverage Card */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-all hover:border-primary/40 group">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider">
              Rule Coverage
            </span>
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs group-hover:bg-primary/20 transition-colors">
              <Sliders className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2.5">
            <span className="text-2xl font-bold font-sans tabular-nums text-foreground tracking-tight">
              {totalRules}
            </span>
            <span className="text-xs text-muted-foreground">total rules</span>
          </div>

          {/* Active vs Inactive ratio */}
          <div className="flex items-center gap-2 mt-2 text-[11px]">
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <CheckCircle2 className="w-3 h-3" />
              {activeRules} Active
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">
              {inactiveRules} Inactive
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {activePercent}%
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 pt-2.5 border-t border-border/60">
          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${activePercent}%` }}
              title={`${activeRules} active rules (${activePercent}%)`}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-1.5 font-mono">
            <span>Enforcing on L7 NGINX</span>
            <span>Key: IP · Header · Path</span>
          </div>
        </div>
      </div>

      {/* 2. Total Throttle Hits Card */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-all hover:border-primary/40 group">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider">
              Total Throttle Hits
            </span>
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs group-hover:bg-primary/20 transition-colors">
              <Activity className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-sans tabular-nums text-foreground tracking-tight">
              {totalHits.toLocaleString()}
            </span>
            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
              <ArrowUpRight className="w-3 h-3" />
              {formatPct(hitsChange)}
            </span>
          </div>

          <div className="text-[11px] text-muted-foreground mt-1 flex items-center justify-between">
            <span>24h traffic evaluation</span>
            <span className="font-mono text-[10px] text-foreground font-medium">Off-main-path UDP</span>
          </div>
        </div>

        {/* Sparkline */}
        <div className="mt-3 pt-2 border-t border-border/60">
          <div className="h-6 w-full">
            <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 24">
              <defs>
                <linearGradient id="hitsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d="M0,20 Q12,18 25,12 T50,5 T75,10 T100,6 L100,24 L0,24 Z"
                fill="url(#hitsGrad)"
              />
              <path
                d="M0,20 Q12,18 25,12 T50,5 T75,10 T100,6"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="1.75"
              />
            </svg>
          </div>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-1 font-mono">
            <span>Throughput: ~{Math.round(totalHits / 1440)} req/min</span>
            <span>24h rolling</span>
          </div>
        </div>
      </div>

      {/* 3. Blocked Requests Card */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-all hover:border-destructive/40 group">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider">
              Blocked Requests (429)
            </span>
            <div className="p-1.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-xs group-hover:bg-destructive/20 transition-colors">
              <Ban className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-sans tabular-nums text-destructive tracking-tight">
              {blockedCount.toLocaleString()}
            </span>
            <span className="text-[10px] text-destructive bg-destructive/10 border border-destructive/20 px-1.5 py-0.5 rounded font-medium flex items-center gap-0.5">
              <ArrowUpRight className="w-3 h-3" />
              {formatPct(blockedChange)}
            </span>
          </div>

          <div className="text-[11px] text-muted-foreground mt-1 flex items-center justify-between">
            <span>Hard 429 Rejections</span>
            <span className="font-mono text-[10px] text-destructive font-medium">{blockRatio}% of hits</span>
          </div>
        </div>

        {/* Dual Ratio Bar */}
        <div className="mt-3 pt-2.5 border-t border-border/60">
          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden flex gap-0.5">
            <div
              className="bg-destructive h-full transition-all duration-500 rounded-l-full"
              style={{ width: `${blockRatio}%` }}
              title={`Blocked: ${blockedCount.toLocaleString()} (${blockRatio}%)`}
            />
            <div
              className="bg-primary/70 h-full transition-all duration-500 rounded-r-full"
              style={{ width: `${100 - blockRatio}%` }}
              title={`Throttled/Delayed: ${throttledCount.toLocaleString()} (${100 - blockRatio}%)`}
            />
          </div>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-1.5 font-mono">
            <span className="text-destructive font-medium">{blockedCount.toLocaleString()} blocked</span>
            <span className="text-primary font-medium">{throttledCount.toLocaleString()} throttled</span>
          </div>
        </div>
      </div>

      {/* 4. Engine Health & Memory Zone Card */}
      <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-all hover:border-primary/40 group">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wider">
              Enforcement Engine
            </span>
            <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xs group-hover:bg-emerald-500/20 transition-colors">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-sans tabular-nums text-foreground tracking-tight">
              {isDisabled ? 'Off' : avgLatency > 0 ? `${avgLatency.toFixed(2)} ms` : '< 0.5 ms'}
            </span>
            {isDisabled ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
                Disabled
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            )}
          </div>

          <div className="text-[11px] text-muted-foreground mt-1 flex items-center justify-between">
            <span>Avg evaluation latency</span>
            <span className="font-mono text-[10px] text-muted-foreground font-medium">
              {isDisabled ? 'Telemetry: Off' : '0 dropped'}
            </span>
          </div>
        </div>

        {/* Memory Zone Bar */}
        <div className="mt-3 pt-2.5 border-t border-border/60">
          <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden flex">
            <div
              className="bg-primary h-full rounded-full transition-all duration-500"
              style={{ width: '76.9%' }}
              title="Memory Zone: 98.4 MB / 128 MB (76.9%)"
            />
          </div>
          <div className="flex justify-between items-center text-[10px] text-muted-foreground mt-1.5 font-mono">
            <span className="flex items-center gap-1">
              <HardDrive className="w-3 h-3 text-muted-foreground" />
              Zone: 98.4MB / 128MB
            </span>
            <span className="text-foreground font-semibold">76.9%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

