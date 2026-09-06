import React from 'react';
import { Shield, CheckCircle2, Ban, Clock } from 'lucide-react';
import type { AccessObject, AccessRuleDocument, AccessStatus } from '../../../lib/api/access';

interface IpAccessStatsCardsProps {
  items: AccessObject[];
  status?: AccessStatus | null;
}

export function IpAccessStatsCards({ items }: IpAccessStatsCardsProps) {
  const rules = items.filter((x) => x.kind === 'rule');
  const now = Math.floor(Date.now() / 1000);

  const totalRules = rules.length;
  const allowlistCount = rules.filter(
    (x) => (x.document as AccessRuleDocument).action === 'allow'
  ).length;
  const blocklistCount = rules.filter(
    (x) => (x.document as AccessRuleDocument).action === 'block'
  ).length;
  const tempBansCount = rules.filter((x) => {
    const d = x.document as AccessRuleDocument;
    return d.action === 'block' && d.enabled && d.expires_at > now;
  }).length;

  const stats = [
    {
      label: 'Total Rules',
      value: totalRules,
      icon: Shield,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10 border-primary/20',
      valColor: 'text-foreground',
    },
    {
      label: 'Allowlist',
      value: allowlistCount,
      icon: CheckCircle2,
      iconColor: 'text-primary',
      iconBg: 'bg-primary/10 border-primary/20',
      valColor: 'text-primary',
    },
    {
      label: 'Blocklist',
      value: blocklistCount,
      icon: Ban,
      iconColor: 'text-destructive',
      iconBg: 'bg-destructive/10 border-destructive/20',
      valColor: 'text-destructive',
    },
    {
      label: 'Temporary Bans',
      value: tempBansCount,
      icon: Clock,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-500/10 border-amber-500/20',
      valColor: 'text-amber-500',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className="bg-card border border-border p-4 flex items-center justify-between shadow-xs rounded-sm transition-all"
          >
            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium block">
                {s.label}
              </span>
              <div className={`text-2xl font-bold tabular-nums tracking-tight mt-1.5 ${s.valColor}`}>
                {s.value}
              </div>
            </div>
            <div className={`w-9 h-9 flex items-center justify-center rounded-sm border ${s.iconBg} ${s.iconColor} shrink-0`}>
              <Icon className="w-4 h-4" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
