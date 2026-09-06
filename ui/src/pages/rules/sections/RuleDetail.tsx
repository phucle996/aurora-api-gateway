import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  MoreHorizontal,
  Copy,
  Check,
  Play,
  Pencil,
  CopyPlus,
  Ban,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { RuleItem } from './RulesTable';

interface RuleDetailProps {
  rule: RuleItem;
  onPreviewRule?: () => void;
}

export function RuleDetail({ rule, onPreviewRule }: RuleDetailProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyExpression = () => {
    navigator.clipboard.writeText(rule.matchConditions.expression);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="xl:col-span-5 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 space-y-5 font-mono">
      {/* Header Info */}
      <div className="space-y-2 pb-3 border-b border-slate-200 dark:border-[#172338]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-slate-100 dark:bg-[#0E1B2C] border border-slate-300 dark:border-[#1C3252] flex items-center justify-center text-slate-600 dark:text-slate-300">
              <FileText className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white font-sans tracking-tight">
                  {rule.name}
                </h3>
                {rule.status === 'Active' && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 uppercase">
                    Active
                  </span>
                )}
                {rule.status === 'Draft' && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-200 dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 uppercase">
                    Draft
                  </span>
                )}
                {rule.status === 'Disabled' && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-200 dark:bg-slate-950 text-slate-500 border border-slate-300 dark:border-slate-800 uppercase">
                    Disabled
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#152338] transition-colors cursor-pointer"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed font-sans">
          {rule.description}
        </p>
      </div>

      {/* Overview Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-200/60 dark:border-[#172338]/60 font-sans">
          Overview
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Category:</span>
            <span className="text-slate-700 dark:text-slate-200">{rule.category}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Action:</span>
            {rule.action === 'Block' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-100 dark:bg-[#3E1418] text-red-700 dark:text-[#FCA5A5] border border-red-300 dark:border-red-800">
                BLOCK
              </span>
            )}
            {rule.action === 'Log' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                LOG
              </span>
            )}
            {rule.action === 'Rate Limit' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800">
                RATE LIMIT
              </span>
            )}
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Severity:</span>
            {rule.severity === 'Critical' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-red-100 dark:bg-[#451216] text-red-700 dark:text-[#FCA5A5] border border-red-300 dark:border-red-700 uppercase">
                Critical
              </span>
            )}
            {rule.severity === 'High' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 uppercase">
                High
              </span>
            )}
            {rule.severity === 'Medium' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-800 uppercase">
                Medium
              </span>
            )}
            {rule.severity === 'Low' && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 uppercase">
                Low
              </span>
            )}
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Scope:</span>
            <span className="text-slate-700 dark:text-slate-200">{rule.scope}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Assigned Policies:</span>
            <span className="text-slate-700 dark:text-slate-200 font-bold">{rule.assignedPolicies}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Last Published:</span>
            <span className="text-slate-400 text-[11px]">
              {rule.lastPublished}
            </span>
          </div>
        </div>
      </div>

      {/* Match Conditions Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-200/60 dark:border-[#172338]/60 font-sans">
          Match Conditions
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Targets:</span>
            <span className="text-slate-700 dark:text-slate-200">{rule.matchConditions.targets}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Pattern Type:</span>
            <span className="text-slate-700 dark:text-slate-200">{rule.matchConditions.patternType}</span>
          </div>

          <div className="space-y-1 pt-1">
            <div className="text-slate-400">Expression:</div>
            <div className="flex items-center justify-between bg-slate-100 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] px-2.5 py-1.5">
              <code className="text-[11px] text-emerald-700 dark:text-emerald-300 select-all break-all">
                {rule.matchConditions.expression}
              </code>
              <button
                type="button"
                onClick={handleCopyExpression}
                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#152338] transition-colors ml-2 shrink-0 cursor-pointer border border-slate-300 dark:border-[#1C293D]"
                title="Copy regex"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Score Contribution:</span>
            <span className="text-slate-700 dark:text-slate-200 font-bold">
              {rule.matchConditions.scoreContribution}
            </span>
          </div>
        </div>
      </div>

      {/* Response Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-200/60 dark:border-[#172338]/60 font-sans">
          Response
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Return Status:</span>
            <span className="text-slate-700 dark:text-slate-200 font-bold">
              {rule.response.returnStatus}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Event Logging:</span>
            <span className="text-slate-700 dark:text-slate-200">
              {rule.response.eventLogging}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Audit Trail:</span>
            <span className="text-slate-700 dark:text-slate-200">
              {rule.response.auditTrail}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons Grid */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-[#172338]">
        <button
          type="button"
          onClick={onPreviewRule}
          className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>Preview rule</span>
        </button>

        <Link
          to={`/rules/${rule.id}/edit`}
          className="bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#142034] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Pencil className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>Edit rule</span>
        </Link>

        <button
          type="button"
          className="bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#142034] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <CopyPlus className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>Clone rule</span>
        </button>

        <button
          type="button"
          className="bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#142034] text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Ban className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <span>Disable rule</span>
        </button>
      </div>

      {/* Recent Changes Group */}
      <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-[#172338]">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-sans">
            Recent Changes
          </h4>
          <a
            href="#changes"
            className="text-[11px] text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300 flex items-center gap-1 font-medium transition-colors"
          >
            <span>View all</span>
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>

        <div className="space-y-2 text-xs">
          {rule.recentChanges.map((change, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-slate-400 py-0.5"
            >
              <div className="flex items-center gap-1.5">
                {change.type === 'create' && (
                  <div className="w-4 h-4 bg-emerald-100 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
                    <Plus className="w-2.5 h-2.5" />
                  </div>
                )}
                {change.type === 'update' && (
                  <div className="w-4 h-4 bg-blue-100 dark:bg-blue-950 border border-blue-300 dark:border-blue-700 flex items-center justify-center text-blue-700 dark:text-blue-400">
                    <Pencil className="w-2.5 h-2.5" />
                  </div>
                )}
                {change.type === 'assign' && (
                  <div className="w-4 h-4 bg-purple-100 dark:bg-purple-950 border border-purple-300 dark:border-purple-700 flex items-center justify-center text-purple-700 dark:text-purple-400">
                    <FileText className="w-2.5 h-2.5" />
                  </div>
                )}
                {change.type === 'disable' && (
                  <div className="w-4 h-4 bg-rose-100 dark:bg-rose-950 border border-rose-300 dark:border-rose-700 flex items-center justify-center text-rose-700 dark:text-rose-400">
                    <Ban className="w-2.5 h-2.5" />
                  </div>
                )}
                <span className="text-slate-700 dark:text-slate-300">{change.action}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-slate-400">{change.user}</span>
                <span className="text-slate-500 text-[10px]">
                  {change.date}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
