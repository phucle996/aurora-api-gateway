import React from 'react';
import { Network, Radio, Sliders, Shield } from 'lucide-react';
import { L4ServiceItem } from '../../../lib/api/l4';

interface L4StatsProps {
  services: L4ServiceItem[];
  selectedFilter: string | null;
  onSelectFilter: (filter: string | null) => void;
}

export function L4Stats({ services, selectedFilter, onSelectFilter }: L4StatsProps) {
  const tcpCount = services.filter((s) => s.protocol.toLowerCase() === 'tcp').length;
  const udpCount = services.filter((s) => s.protocol.toLowerCase() === 'udp').length;
  const aclCount = services.filter((s) => {
    try {
      const arr = JSON.parse(s.acl_rules_json || '[]');
      return Array.isArray(arr) && arr.length > 0;
    } catch {
      return false;
    }
  }).length;

  const statCards = [
    {
      id: 'total',
      label: 'Total L4 Services',
      value: services.length,
      sub: 'Active stream listeners',
      icon: <Network className="w-5 h-5 text-primary" />,
      iconBg: 'bg-primary/10 border border-primary/20',
      activeRing: 'ring-2 ring-primary/40',
      filterKey: null,
    },
    {
      id: 'tcp',
      label: 'TCP Listeners',
      value: tcpCount,
      sub: 'Databases, Redis, SSH',
      icon: <Radio className="w-5 h-5 text-emerald-500" />,
      iconBg: 'bg-emerald-500/10 border border-emerald-500/20',
      activeRing: 'ring-2 ring-emerald-500/40',
      filterKey: 'tcp',
    },
    {
      id: 'udp',
      label: 'UDP Listeners',
      value: udpCount,
      sub: 'DNS, VoIP, Syslog',
      icon: <Sliders className="w-5 h-5 text-violet-400" />,
      iconBg: 'bg-violet-500/10 border border-violet-500/20',
      activeRing: 'ring-2 ring-violet-500/40',
      filterKey: 'udp',
    },
    {
      id: 'acl',
      label: 'ACL Protected',
      value: aclCount,
      sub: 'Allow / Deny CIDR active',
      icon: <Shield className="w-5 h-5 text-amber-400" />,
      iconBg: 'bg-amber-500/10 border border-amber-500/20',
      activeRing: 'ring-2 ring-amber-500/40',
      filterKey: 'acl',
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
            <p className="text-[11px] text-muted-foreground mt-0.5">{card.sub}</p>
          </div>
        );
      })}
    </div>
  );
}

