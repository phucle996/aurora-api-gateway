import React from 'react';
import type { AccessRuleDocument } from '../../../lib/api/access';

interface RuleSummaryProps {
  form: AccessRuleDocument;
  values: string;
}

export function RuleSummaryPanel({ form, values }: RuleSummaryProps) {
  const count = values
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean).length;

  const sourceLabels: Record<AccessRuleDocument['source'], string> = {
    ip: 'IP Address',
    cidr: 'CIDR / Network',
    country: 'Country / Region',
    asn: 'ASN',
    group: 'IP Group',
  };

  const scheduleLabels: Record<string, string> = {
    always: 'Always',
    business_hours: 'Business Hours (09:00–18:00 UTC)',
    weekend: 'Weekend UTC',
    night: 'Night (22:00–06:00 UTC)',
  };

  const actionLabels: Record<AccessRuleDocument['action'], { label: string; color: string }> = {
    block: { label: '🚫 Block', color: 'text-rose-600 dark:text-rose-400 font-semibold' },
    allow: { label: '✅ Allow', color: 'text-emerald-600 dark:text-emerald-400 font-semibold' },
    log: { label: '📋 Log only', color: 'text-cyan-600 dark:text-cyan-400 font-semibold' },
  };

  const scopeTarget = form.host === '*' ? 'All Domains' : form.host;
  const scopePath = !form.path_prefix || form.path_prefix === '/' ? 'All Paths' : form.path_prefix;
  const scopeMethod = form.method === '*' ? 'All Methods' : form.method;

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 shadow-xs rounded-sm font-sans text-xs space-y-3">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-[#152030] pb-2">
        Rule Summary
      </h2>

      <div className="space-y-2">
        {/* Name */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Name</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
            {form.name || '-'}
          </span>
        </div>

        {/* Action */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Action</span>
          <span className={actionLabels[form.action].color}>
            {actionLabels[form.action].label}
          </span>
        </div>

        {/* Source Type */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Source Type</span>
          <span className="text-slate-800 dark:text-slate-200 font-medium">
            {sourceLabels[form.source]}
          </span>
        </div>

        {/* Source count */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Source</span>
          <span className="text-slate-800 dark:text-slate-200">
            {count > 0 ? `${count} ${form.source === 'ip' ? 'IP addresses' : 'items'}` : '-'}
          </span>
        </div>

        {/* Scope */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 dark:text-slate-400 shrink-0">Scope</span>
          <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px] truncate text-right">
            {scopeTarget} · {scopePath} · {scopeMethod}
          </span>
        </div>

        {/* Time Window */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Time Window</span>
          <span className="text-slate-800 dark:text-slate-200">
            {scheduleLabels[form.schedule] || form.schedule}
          </span>
        </div>

        {/* Priority */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Priority</span>
          <span className="text-slate-800 dark:text-slate-200 font-bold font-mono">
            {form.priority}
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Status</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.enabled ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className={form.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
              {form.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>

        {/* Log Event */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Log Event</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.log ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className={form.log ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
              {form.log ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>

        {/* Add to Reputation */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Add to Reputation</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.reputation ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className={form.reputation ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
              {form.reputation ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>

        {/* Alert */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Alert</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.alert ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className={form.alert ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
              {form.alert ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
