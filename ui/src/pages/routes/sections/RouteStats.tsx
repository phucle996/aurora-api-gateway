import React from 'react';
import { Route, CheckCircle2, Zap, ArrowRightLeft } from 'lucide-react';
import type { RouteItem } from '../types';

interface RouteStatsProps {
  routes: RouteItem[];
  selectedFilter: string | null;
  onSelectFilter: (filter: string | null) => void;
}

export function RouteStats({
  routes,
  selectedFilter,
  onSelectFilter,
}: RouteStatsProps) {
  const total = routes.length;
  const active = routes.filter((r) => r.enabled).length;
  const wsCount = routes.filter((r) => r.websocket).length;
  const stripCount = routes.filter((r) => r.strip_path).length;

  const statCards = [
    {
      id: 'total',
      label: 'Total Routes',
      value: total,
      icon: <Route className="w-5 h-5 text-primary" />,
      iconBg: 'bg-primary/10 border border-primary/20',
      activeRing: 'ring-2 ring-primary/40',
      filterKey: null,
    },
    {
      id: 'active',
      label: 'Active Serving',
      value: active,
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      iconBg: 'bg-emerald-500/10 border border-emerald-500/20',
      activeRing: 'ring-2 ring-emerald-500/40',
      filterKey: 'active',
    },
    {
      id: 'websocket',
      label: 'WebSocket Upgraded',
      value: wsCount,
      icon: <Zap className="w-5 h-5 text-violet-400" />,
      iconBg: 'bg-violet-500/10 border border-violet-500/20',
      activeRing: 'ring-2 ring-violet-500/40',
      filterKey: 'websocket',
    },
    {
      id: 'strip_path',
      label: 'Path Stripping',
      value: stripCount,
      icon: <ArrowRightLeft className="w-5 h-5 text-amber-400" />,
      iconBg: 'bg-amber-500/10 border border-amber-500/20',
      activeRing: 'ring-2 ring-amber-500/40',
      filterKey: 'strip_path',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
      {statCards.map((card) => {
        const isSelected = selectedFilter === card.filterKey;
        return (
          <div
            key={card.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectFilter(isSelected ? null : card.filterKey)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectFilter(isSelected ? null : card.filterKey);
              }
            }}
            className={`bg-card/80 backdrop-blur-xs border border-border/70 rounded-xl p-4 transition-all duration-200 cursor-pointer text-left hover:border-primary/40 hover:shadow-xs ${isSelected ? `${card.activeRing} border-transparent` : ''
              }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {card.label}
              </span>
              <div className={`p-2 rounded-lg ${card.iconBg}`}>
                {card.icon}
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-foreground font-mono">
                {card.value}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
