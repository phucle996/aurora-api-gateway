import React from 'react';
import { Shield, Gauge, GlobeLock } from 'lucide-react';
import type { PolicyRuleItem } from './PolicyRulesSection';
import type { PolicyType } from './BasicInfoSection';

interface PolicySummaryPanelProps {
  name: string;
  policyType: PolicyType;
  enabled: boolean;
  priority: number;
  rules: PolicyRuleItem[];
  target: string;
  path: string;
  httpMethod: string;
  enableLogging: boolean;
  enableShadowMode: boolean;
}

export function PolicySummaryPanel({
  name,
  policyType,
  enabled,
  priority,
  rules,
  target,
  path,
  httpMethod,
  enableLogging,
  enableShadowMode,
}: PolicySummaryPanelProps) {
  const targetLabel = target === '*' ? 'All Domains' : target;
  const methodLabel = httpMethod === '*' ? 'All Methods' : httpMethod;

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 shadow-xs rounded-sm font-mono text-xs space-y-3">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-[#152030] pb-2">
        Policy Summary
      </h2>

      <div className="space-y-2.5">
        {/* Name */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Name</span>
          <span className="font-semibold text-slate-900 dark:text-white">
            {name || '—'}
          </span>
        </div>

        {/* Type */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Type</span>
          <div className="flex items-center gap-1 text-slate-800 dark:text-slate-200">
            {policyType === 'waf' && (
              <>
                <Shield className="w-3.5 h-3.5 text-blue-500" />
                <span>WAF Policy</span>
              </>
            )}
            {policyType === 'rate-limit' && (
              <>
                <Gauge className="w-3.5 h-3.5 text-cyan-500" />
                <span>Rate Limit</span>
              </>
            )}
            {policyType === 'access-control' && (
              <>
                <GlobeLock className="w-3.5 h-3.5 text-amber-500" />
                <span>Access Control</span>
              </>
            )}
          </div>
        </div>

        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Status</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                enabled ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className={enabled ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-500'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Priority */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Priority</span>
          <span className="text-slate-800 dark:text-slate-200">{priority}</span>
        </div>

        {/* Rules */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Rules</span>
          <span className="text-slate-800 dark:text-slate-200">
            {rules.length} rule{rules.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* Scope */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 dark:text-slate-400 shrink-0">Scope</span>
          <span className="text-slate-800 dark:text-slate-200 truncate text-right">
            {targetLabel}, {path || '/*'}, {methodLabel}
          </span>
        </div>

        {/* Logging */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Logging</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                enableLogging ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
            <span className={enableLogging ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-500'}>
              {enableLogging ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Shadow Mode */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Shadow Mode</span>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                enableShadowMode ? 'bg-amber-500' : 'bg-slate-400'
              }`}
            />
            <span className={enableShadowMode ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-500'}>
              {enableShadowMode ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PolicySummaryPanel;
