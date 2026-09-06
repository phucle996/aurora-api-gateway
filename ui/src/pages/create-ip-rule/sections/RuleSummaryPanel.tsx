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
    block: { label: '🚫 Block', color: 'text-destructive font-semibold' },
    allow: { label: '✅ Allow', color: 'text-primary font-semibold' },
    log: { label: '📋 Log only', color: 'text-sky-500 font-semibold' },
  };

  const scopeTarget = form.host === '*' ? 'All Domains' : form.host;
  const scopePath = !form.path_prefix || form.path_prefix === '/' ? 'All Paths' : form.path_prefix;
  const scopeMethod = form.method === '*' ? 'All Methods' : form.method;

  return (
    <section className="bg-card border border-border p-4 shadow-xs rounded-sm font-sans text-xs space-y-3">
      <h2 className="text-sm font-semibold text-foreground border-b border-border pb-2">
        Rule Summary
      </h2>

      <div className="space-y-2">
        {/* Name */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Name</span>
          <span className="font-semibold text-foreground truncate max-w-[180px]">
            {form.name || '-'}
          </span>
        </div>

        {/* Action */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Action</span>
          <span className={actionLabels[form.action].color}>
            {actionLabels[form.action].label}
          </span>
        </div>

        {/* Source Type */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Source Type</span>
          <span className="text-foreground font-medium">
            {sourceLabels[form.source]}
          </span>
        </div>

        {/* Source count */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Source</span>
          <span className="text-foreground">
            {count > 0 ? `${count} ${form.source === 'ip' ? 'IP addresses' : 'items'}` : '-'}
          </span>
        </div>

        {/* Scope */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground shrink-0">Scope</span>
          <span className="text-foreground font-mono text-[11px] truncate text-right">
            {scopeTarget} · {scopePath} · {scopeMethod}
          </span>
        </div>

        {/* Time Window */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Time Window</span>
          <span className="text-foreground">
            {scheduleLabels[form.schedule] || form.schedule}
          </span>
        </div>

        {/* Priority */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Priority</span>
          <span className="text-foreground font-bold font-mono">
            {form.priority}
          </span>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Status</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.enabled ? 'bg-primary' : 'bg-muted-foreground'
              }`}
            />
            <span className={form.enabled ? 'text-primary' : 'text-muted-foreground'}>
              {form.enabled ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>

        {/* Log Event */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Log Event</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.log ? 'bg-primary' : 'bg-muted-foreground'
              }`}
            />
            <span className={form.log ? 'text-primary' : 'text-muted-foreground'}>
              {form.log ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>

        {/* Add to Reputation */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Add to Reputation</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.reputation ? 'bg-primary' : 'bg-muted-foreground'
              }`}
            />
            <span className={form.reputation ? 'text-primary' : 'text-muted-foreground'}>
              {form.reputation ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>

        {/* Alert */}
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Alert</span>
          <span className="flex items-center gap-1 font-medium">
            <span
              className={`w-2 h-2 rounded-full ${
                form.alert ? 'bg-primary' : 'bg-muted-foreground'
              }`}
            />
            <span className={form.alert ? 'text-primary' : 'text-muted-foreground'}>
              {form.alert ? 'Enabled' : 'Disabled'}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}
