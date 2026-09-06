import React from 'react';
import { Shield, CheckCircle2, Ban, Clock, Server } from 'lucide-react';
import type { AccessObject, AccessRuleDocument, AccessStatus } from '../../../lib/api/access';

interface IpAccessStatsCardsProps {
  items: AccessObject[];
  status?: AccessStatus | null;
}

export function IpAccessStatsCards({ items, status }: IpAccessStatsCardsProps) {
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
      iconColor: 'text-blue-500 dark:text-blue-400',
      iconBg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/40',
      valColor: 'text-slate-900 dark:text-white',
    },
    {
      label: 'Allowlist',
      value: allowlistCount,
      icon: CheckCircle2,
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      iconBg: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/40',
      valColor: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Blocklist',
      value: blocklistCount,
      icon: Ban,
      iconColor: 'text-rose-600 dark:text-rose-400',
      iconBg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/40',
      valColor: 'text-rose-600 dark:text-rose-400',
    },
    {
      label: 'Temporary Bans',
      value: tempBansCount,
      icon: Clock,
      iconColor: 'text-amber-600 dark:text-amber-400',
      iconBg: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/40',
      valColor: 'text-amber-600 dark:text-amber-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-sans">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.label}
            className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 flex items-center justify-between shadow-xs rounded-sm transition-all"
          >
            <div>
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-sans font-medium block">
                {s.label}
              </span>
              <div className={`text-2xl font-bold font-sans tabular-nums tracking-tight mt-1.5 ${s.valColor}`}>
                {s.value}
              </div>
            </div>
            <div className={`w-9 h-9 flex items-center justify-center rounded-sm border ${s.iconBg} ${s.iconColor} shrink-0`}>
              <Icon className="w-4 h-4" />
            </div>
          </div>
        );
      })}

      {status && status.nodes && status.nodes.length > 0 && (
        <div className="col-span-1 sm:col-span-2 xl:col-span-4 flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] rounded-sm text-xs transition-all">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-xs bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Server className="w-3.5 h-3.5" />
            </div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Edge Cluster Sync:
              </span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {status.nodes.filter((n) => n.phase === 'observed' && n.release_id === status.release_id).length}
                /{status.nodes.length} Nodes Synchronized
              </span>
              <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px]">
                (Release #{status.release_id})
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {status.nodes.map((n) => {
              const isSynced = n.phase === 'observed' && n.release_id === status.release_id;
              return (
                <div
                  key={n.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xs font-mono text-[11px] bg-slate-50 dark:bg-[#121E31] border border-slate-200 dark:border-[#1D2E47] text-slate-700 dark:text-slate-300 shadow-2xs"
                  title={`${n.id}: phase=${n.phase}, release=#${n.release_id}\n${n.message}\nLast sync: ${n.updated_at}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isSynced ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                    }`}
                  />
                  <span className="font-semibold">{n.id}</span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    [{n.phase}]
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
