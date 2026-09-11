import React from 'react';
import { ShieldCheck, CheckCircle2, Globe, Lock } from 'lucide-react';
import type { CertificateItem } from '../types';

interface CertificateStatsProps {
  certificates: CertificateItem[];
  selectedFilter: string | null;
  onSelectFilter: (filter: string | null) => void;
}

export function CertificateStats({
  certificates,
  selectedFilter,
  onSelectFilter,
}: CertificateStatsProps) {
  const total = certificates.length;
  const active = certificates.filter((c) => c.enabled).length;
  const mtlsCount = certificates.filter((c) => c.mtls_enabled).length;
  const wildcardCount = certificates.filter((c) => {
    try {
      const snis: string[] = JSON.parse(c.snis_json || '[]');
      return snis.some((s) => s.includes('*'));
    } catch {
      return false;
    }
  }).length;

  const statCards = [
    {
      id: 'total',
      label: 'Total Certificates',
      value: total,
      icon: <ShieldCheck className="w-5 h-5 text-primary" />,
      iconBg: 'bg-primary/10 border border-primary/20',
      activeRing: 'ring-2 ring-primary/40',
      filterKey: null,
    },
    {
      id: 'active',
      label: 'Active & Bound',
      value: active,
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      iconBg: 'bg-emerald-500/10 border border-emerald-500/20',
      activeRing: 'ring-2 ring-emerald-500/40',
      filterKey: 'active',
    },
    {
      id: 'wildcard',
      label: 'Wildcard SNIs',
      value: wildcardCount,
      icon: <Globe className="w-5 h-5 text-indigo-400" />,
      iconBg: 'bg-indigo-500/10 border border-indigo-500/20',
      activeRing: 'ring-2 ring-indigo-500/40',
      filterKey: 'wildcard',
    },
    {
      id: 'mtls',
      label: 'mTLS Enabled',
      value: mtlsCount,
      icon: <Lock className="w-5 h-5 text-amber-400" />,
      iconBg: 'bg-amber-500/10 border border-amber-500/20',
      activeRing: 'ring-2 ring-amber-500/40',
      filterKey: 'mtls',
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
            className={`bg-card/80 backdrop-blur-xs border border-border/70 rounded-xl p-4 transition-all duration-200 cursor-pointer text-left hover:border-primary/40 hover:shadow-xs ${
              isSelected ? `${card.activeRing} border-transparent` : ''
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
