import React from 'react';
import { Shield, ShieldAlert, Eye } from 'lucide-react';
import type { PolicyRuleItem } from './PolicyRulesSection';
import type { PolicyMode } from './BasicInfoSection';

interface PolicySummaryPanelProps {
  name: string;
  mode: PolicyMode;
  priority: number;
  rules: PolicyRuleItem[];
  target: string;
  isEditing: boolean;
  expectedVersion: number;
}

export function PolicySummaryPanel({
  name,
  mode,
  priority,
  rules,
  target,
  isEditing,
  expectedVersion,
}: PolicySummaryPanelProps) {
  const targetLabel = target === '*' || target === 'All Domains' ? '* (All Domains)' : (target.trim() || '*');
  const activeRulesCount = rules.filter((r) => r.enabled).length;

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 shadow-xs rounded-sm font-sans text-xs space-y-3">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white border-b border-slate-200 dark:border-[#152030] pb-2">
        Policy Summary
      </h2>

      <div className="space-y-2.5">
        {/* Name */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Name</span>
          <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[180px]">
            {name || '—'}
          </span>
        </div>

        {/* Mode */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Mode</span>
          <div className="flex items-center gap-1.5">
            {mode === 'mixed' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900/50 font-bold uppercase text-[10px]">
                <Shield className="w-3 h-3" />
                Mixed
              </span>
            )}
            {mode === 'block' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 font-bold uppercase text-[10px]">
                <ShieldAlert className="w-3 h-3" />
                Block
              </span>
            )}
            {mode === 'detect' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-900/50 font-bold uppercase text-[10px]">
                <Eye className="w-3 h-3" />
                Detect
              </span>
            )}
          </div>
        </div>

        {/* Priority */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Priority</span>
          <span className="text-slate-800 dark:text-slate-200 font-bold">{priority}</span>
        </div>

        {/* Scope Host */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500 dark:text-slate-400 shrink-0">Target Scope</span>
          <span className="text-slate-800 dark:text-slate-200 font-mono font-medium truncate text-right">
            {targetLabel}
          </span>
        </div>

        {/* Attached Rules */}
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400">Attached Rules</span>
          <span className="text-slate-800 dark:text-slate-200">
            {activeRulesCount} active ({rules.length} total)
          </span>
        </div>

        {/* Revision */}
        <div className="flex items-center justify-between border-t border-slate-100 dark:border-[#152030] pt-2 text-[11px]">
          <span className="text-slate-400">Revision State</span>
          <span className="text-slate-600 dark:text-slate-400">
            {isEditing ? `Targeting v${expectedVersion + 1}` : 'New Policy (Draft)'}
          </span>
        </div>
      </div>
    </section>
  );
}

export default PolicySummaryPanel;
