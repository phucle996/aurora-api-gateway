import React from 'react';
import { FileText, Shield, Eye, AlertTriangle } from 'lucide-react';
import type { EventItem } from './EventsTable';

interface EventsStatsProps {
  events?: EventItem[];
}

export function EventsStats({ events = [] }: EventsStatsProps) {
  const total = events.length;
  const blocked = events.filter((e) => e.action === 'BLOCK').length;
  const logged = events.filter((e) => e.action === 'LOG').length;
  const critical = events.filter((e) => e.severity === 'Critical').length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 font-sans">
      {/* Total Events */}
      <div className="bg-card border border-border p-4 hover:border-input shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Total Events
          </span>
          <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white font-sans tabular-nums tracking-tight mt-1.5">
          {total}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground font-sans">
          <span>{total > 0 ? `${total} security events logged` : 'No events recorded'}</span>
        </div>
      </div>

      {/* Blocked Requests */}
      <div className="bg-card border border-border p-4 hover:border-input shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Blocked Requests
          </span>
          <Shield className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white font-sans tabular-nums tracking-tight mt-1.5">
          {blocked}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground font-sans">
          <span>{blocked > 0 ? `${blocked} threat requests dropped` : 'No blocked requests'}</span>
        </div>
      </div>

      {/* Logged Events */}
      <div className="bg-card border border-border p-4 hover:border-input shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Logged Events
          </span>
          <Eye className="w-4 h-4 text-slate-400 dark:text-slate-500" />
        </div>
        <div className="text-2xl font-bold text-slate-900 dark:text-white font-sans tabular-nums tracking-tight mt-1.5">
          {logged}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground font-sans">
          <span>{logged > 0 ? `${logged} monitored events recorded` : 'No logged events'}</span>
        </div>
      </div>

      {/* Critical Alerts */}
      <div className="bg-card border border-border p-4 hover:border-input shadow-xs rounded-sm transition-all">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-sans font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Critical Alerts
          </span>
          <AlertTriangle className="w-4 h-4 text-rose-500 dark:text-rose-400" />
        </div>
        <div className="text-2xl font-bold text-rose-600 dark:text-rose-400 font-sans tabular-nums tracking-tight mt-1.5">
          {critical}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground font-sans">
          <span>{critical > 0 ? `${critical} urgent threat anomalies` : 'No critical alerts'}</span>
        </div>
      </div>
    </div>
  );
}

