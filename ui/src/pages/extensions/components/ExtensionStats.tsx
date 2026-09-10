import React from 'react';
import { ExtensionStatsData, ExtensionCategory } from '../types';
import { CATEGORIES_META } from '../data/catalog';
import { Blocks, CheckCircle2, ShieldAlert } from 'lucide-react';

interface ExtensionStatsProps {
  stats: ExtensionStatsData;
  onSelectCategory?: (cat: ExtensionCategory) => void;
  selectedCategory?: ExtensionCategory;
}

export function ExtensionStats({
  stats,
  onSelectCategory,
  selectedCategory,
}: ExtensionStatsProps) {
  const activePercent = stats.total > 0 ? Math.round((stats.enabled / stats.total) * 100) : 0;

  const categoryOrder: ExtensionCategory[] = [
    'security_engine',
    'authentication',
    'authorization_security',
    'traffic_control',
    'request_transformation',
    'response_transformation',
    'observability',
    'resilience_upstream',
    'cache_content',
    'integration_runtime',
    'ai_gateway',
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {/* 1. Total Extensions */}
      <div className="bg-card/75 backdrop-blur-xs border border-border/70 rounded-lg p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Total Catalog
          </span>
          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
            <Blocks className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-foreground">{stats.total}</span>
          <span className="text-xs text-muted-foreground font-medium">plugins in 11 groups</span>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Dynamic declarative synchronization
        </div>
      </div>

      {/* 2. Active / Enabled */}
      <div className="bg-card/75 backdrop-blur-xs border border-border/70 rounded-lg p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Active / Enabled
          </span>
          <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.enabled}
          </span>
          <span className="text-xs text-muted-foreground font-medium">({activePercent}% active)</span>
        </div>
        <div className="mt-2 w-full bg-muted/60 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${activePercent}%` }}
          />
        </div>
      </div>

      {/* 3. Inactive / Standby */}
      <div className="bg-card/75 backdrop-blur-xs border border-border/70 rounded-lg p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Available / Standby
          </span>
          <div className="p-1.5 rounded-md bg-muted text-muted-foreground">
            <ShieldAlert className="w-4 h-4 opacity-70" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-bold tracking-tight text-muted-foreground">
            {stats.disabled}
          </span>
          <span className="text-xs text-muted-foreground font-medium">ready to activate</span>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground/80">
          Zero-overhead dormant compiled state
        </div>
      </div>

      {/* 4. Ecosystem Breakdown (Interactive chips) */}
      <div className="bg-card/75 backdrop-blur-xs border border-border/70 rounded-lg p-4 flex flex-col justify-between shadow-xs">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Ecosystem Breakdown
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1 text-[10px] max-h-20 overflow-y-auto pr-1 no-scrollbar">
          {categoryOrder.map((catKey) => {
            const count = stats.byCategory[catKey] || 0;
            const meta = CATEGORIES_META[catKey];
            const isSelected = selectedCategory === catKey;

            return (
              <button
                key={catKey}
                type="button"
                onClick={() => onSelectCategory && onSelectCategory(catKey)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs font-medium cursor-pointer transition-all border ${
                  isSelected
                    ? `${meta.badgeClass} ring-1 ring-primary font-bold shadow-2xs`
                    : `${meta.badgeClass} opacity-85 hover:opacity-100`
                }`}
                title={`Filter by ${meta.label}`}
              >
                <span>{meta.shortLabel}:</span>
                <span className="font-mono font-bold">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground/80">
          Click any chip to filter plugins
        </div>
      </div>
    </div>
  );
}
