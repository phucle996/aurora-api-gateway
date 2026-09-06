import React from 'react';
import { Globe, CheckCircle2, PauseCircle, ShieldCheck } from 'lucide-react';
import type { DomainItem } from '../types';

interface DomainsStatsProps {
  domains: DomainItem[];
  selectedFilter: string | null;
  onSelectFilter: (filter: string | null) => void;
}

export function DomainsStats({
  domains,
  selectedFilter,
  onSelectFilter,
}: DomainsStatsProps) {
  const total = domains.length;
  const active = domains.filter((d) => d.status === 'Active').length;
  const inactive = domains.filter((d) => d.status === 'Inactive').length;
  const mtls = domains.filter((d) => d.tlsType === 'mTLS').length;

  const statCards = [
    {
      id: 'total',
      label: 'Total Domains',
      value: total,
      icon: <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />,
      iconBg: 'bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900/40',
      activeRing: 'ring-2 ring-blue-500/40',
      filterKey: null,
    },
    {
      id: 'active',
      label: 'Active',
      value: active,
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />,
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-100 dark:border-emerald-900/40',
      activeRing: 'ring-2 ring-emerald-500/40',
      filterKey: 'status:Active',
    },
    {
      id: 'inactive',
      label: 'Inactive',
      value: inactive,
      icon: <PauseCircle className="w-5 h-5 text-slate-500 dark:text-slate-400" />,
      iconBg: 'bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50',
      activeRing: 'ring-2 ring-slate-400/40',
      filterKey: 'status:Inactive',
    },
    {
      id: 'mtls',
      label: 'mTLS Enabled',
      value: mtls,
      icon: <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />,
      iconBg: 'bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-100 dark:border-indigo-900/40',
      activeRing: 'ring-2 ring-indigo-500/40',
      filterKey: 'tls:mTLS',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
      {statCards.map((card, index) => {
        const isSelected =
          (card.filterKey === null && selectedFilter === null) ||
          (card.filterKey !== null && selectedFilter === card.filterKey);

        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelectFilter(isSelected && card.filterKey !== null ? null : card.filterKey)}
            style={{ animationDelay: `${index * 60}ms` }}
            className={`text-left bg-card border rounded-lg p-4 transition-all duration-200 cursor-pointer group flex items-center justify-between shadow-xs hover:shadow-md hover:-translate-y-0.5 animate-in fade-in slide-in-from-bottom-2 fill-mode-both ${isSelected && card.filterKey !== null
                ? `${card.activeRing} border-primary/40 bg-accent/20`
                : 'border-border hover:border-border/80'
              }`}
          >
            <div>
              <p className="text-xs font-medium text-muted-foreground tracking-tight mb-1 group-hover:text-foreground transition-colors">
                {card.label}
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-foreground">
                  {card.value}
                </span>
              </div>
            </div>
            <div
              className={`p-2.5 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-110 ${card.iconBg}`}
            >
              {card.icon}
            </div>
          </button>
        );
      })}
    </div>
  );
}
