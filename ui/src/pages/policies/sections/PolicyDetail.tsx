import React from 'react';
import {
  FileText,
  MoreHorizontal,
  ArrowRight,
  Check,
  Play,
  Upload,
  Copy,
  Ban,
  CheckSquare,
  Edit3,
} from 'lucide-react';
import { PolicyItem } from './PoliciesTable';

interface PolicyDetailProps {
  policy: PolicyItem;
}

export function PolicyDetail({ policy }: PolicyDetailProps) {
  return (
    <div className="xl:col-span-5 bg-[#0B1320] border border-[#172338] p-4 space-y-5 font-mono">
      {/* Detail Header */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-[#172338]">
        <div className="flex items-start gap-2.5">
          <div className="w-7 h-7 bg-[#0E1B2C] border border-[#1C3252] flex items-center justify-center text-slate-300 mt-0.5">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white font-sans tracking-tight">
                {policy.name}
              </h2>
              <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 uppercase">
                {policy.status}
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              {policy.description}
            </p>
          </div>
        </div>

        <button
          type="button"
          className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#152338] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Overview Section */}
      <div className="space-y-2 text-xs">
        <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-[#172338]/60 font-sans">
          Overview
        </h3>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Scope:</span>
            <span className="text-slate-200 font-bold">{policy.scope}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Mode:</span>
            <span
              className={`px-1.5 py-0.5 text-[10px] font-bold border uppercase ${
                policy.mode === 'Block'
                  ? 'bg-rose-950 text-rose-300 border-rose-800'
                  : policy.mode === 'Detect'
                  ? 'bg-blue-950 text-blue-300 border-blue-800'
                  : 'bg-emerald-950 text-emerald-300 border-emerald-800'
              }`}
            >
              {policy.mode === 'Block' ? 'Blocking' : policy.mode}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Priority:</span>
            <span
              className={`font-bold ${
                policy.priority === 'High' ? 'text-rose-400' : 'text-amber-400'
              }`}
            >
              {policy.priority}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Rule Sets:</span>
            <span className="text-slate-200 font-bold">{policy.ruleSetsCount} active sets</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Last Published:</span>
            <span className="text-slate-400 text-[11px]">{policy.lastUpdated}</span>
          </div>
        </div>
      </div>

      {/* Rule Groups Section */}
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between pb-1 border-b border-[#172338]/60">
          <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-sans">
            Rule Groups ({policy.ruleGroups.length})
          </h3>
          <a
            href="#rulesets"
            className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium transition-colors"
          >
            <span>Manage Rule Sets</span>
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 pt-1">
          {policy.ruleGroups.map((group) => (
            <div key={group} className="flex items-center gap-1.5">
              <div className="w-3.5 h-3.5 bg-emerald-950 border border-emerald-700 flex items-center justify-center text-emerald-400">
                <Check className="w-2.5 h-2.5 stroke-[3]" />
              </div>
              <span className="truncate">{group}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Enforcement Action Buttons */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#172338]">
        <button
          type="button"
          className="bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>Preview changes</span>
        </button>

        <button
          type="button"
          className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Upload className="w-3.5 h-3.5 text-slate-400" />
          <span>Publish policy</span>
        </button>

        <button
          type="button"
          className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Copy className="w-3.5 h-3.5 text-slate-400" />
          <span>Clone policy</span>
        </button>

        <button
          type="button"
          className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Ban className="w-3.5 h-3.5 text-slate-400" />
          <span>Disable policy</span>
        </button>
      </div>

      {/* Recent Activity Section */}
      <div className="space-y-2 pt-2 border-t border-[#172338]">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider font-sans">
            Recent Activity
          </h3>
          <a
            href="#activity"
            className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium transition-colors"
          >
            <span>View all</span>
            <ArrowRight className="w-3 h-3" />
          </a>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between text-slate-400 py-0.5">
            <div className="flex items-center gap-1.5 truncate">
              <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-slate-300 truncate">Policy published</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500 shrink-0">
              <span>Admin User</span>
              <span>2026-09-05 07:42 UTC</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-slate-400 py-0.5">
            <div className="flex items-center gap-1.5 truncate">
              <CheckSquare className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-slate-300 truncate">
                Rule group enabled (Sensitive Endpoint)
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500 shrink-0">
              <span>Admin User</span>
              <span>2026-09-05 07:41 UTC</span>
            </div>
          </div>

          <div className="flex items-center justify-between text-slate-400 py-0.5">
            <div className="flex items-center gap-1.5 truncate">
              <Edit3 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="text-slate-300 truncate">
                Assignment updated
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-slate-500 shrink-0">
              <span>Admin User</span>
              <span>2026-09-04 12:18 UTC</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
