import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface RuleSummaryCardProps {
  ruleName: string;
  ruleId: string;
  currentVersion: string;
  status: 'Active' | 'Inactive' | 'Draft';
  policy: string;
  lastModified: string;
  createdBy: string;
}

export function RuleSummaryCard({
  ruleName,
  ruleId,
  currentVersion,
  status,
  policy,
  lastModified,
  createdBy,
}: RuleSummaryCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    navigator.clipboard.writeText(ruleId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-card border border-border rounded-xs p-4 shadow-xs font-sans">
      <h2 className="text-xs font-semibold text-slate-900 dark:text-white uppercase tracking-wider mb-3">
        Rule Summary
      </h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4 text-xs">
        {/* Rule Name */}
        <div>
          <div className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">
            Rule Name
          </div>
          <div className="font-semibold text-slate-900 dark:text-white truncate">
            {ruleName}
          </div>
        </div>

        {/* Rule ID */}
        <div>
          <div className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">
            Rule ID
          </div>
          <button
            type="button"
            onClick={handleCopyId}
            title="Click to copy Rule ID"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] rounded-xs font-mono text-slate-800 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-colors cursor-pointer text-[11px]"
          >
            <span>{ruleId}</span>
            {copied ? (
              <Check className="w-2.5 h-2.5 text-emerald-500" />
            ) : (
              <Copy className="w-2.5 h-2.5 text-slate-400" />
            )}
          </button>
        </div>

        {/* Current Version */}
        <div>
          <div className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">
            Current Version
          </div>
          <div className="font-bold text-blue-600 dark:text-blue-400 font-mono">
            {currentVersion}
          </div>
        </div>

        {/* Status */}
        <div>
          <div className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">
            Status
          </div>
          <div className="flex items-center gap-1.5 font-medium">
            <span
              className={`w-2 h-2 rounded-full inline-block ${
                status === 'Active' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400 dark:bg-slate-500'
              }`}
            />
            <span
              className={
                status === 'Active'
                  ? 'text-emerald-600 dark:text-emerald-400 font-bold'
                  : 'text-slate-600 dark:text-slate-400'
              }
            >
              {status}
            </span>
          </div>
        </div>

        {/* Policy */}
        <div>
          <div className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">
            Policy
          </div>
          <div className="text-slate-800 dark:text-slate-200 truncate font-medium">
            {policy}
          </div>
        </div>

        {/* Last Modified */}
        <div>
          <div className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">
            Last Modified
          </div>
          <div className="text-slate-700 dark:text-slate-300 text-[11px] font-mono">
            {lastModified}
          </div>
        </div>

        {/* Created By */}
        <div>
          <div className="text-slate-500 dark:text-slate-400 text-[11px] mb-1">
            Created By
          </div>
          <div className="text-slate-700 dark:text-slate-300 font-medium">
            {createdBy}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RuleSummaryCard;
