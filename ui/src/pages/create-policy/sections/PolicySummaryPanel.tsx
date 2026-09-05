import React from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Check,
  Plus,
  Save,
  X,
  Play,
} from 'lucide-react';

interface PolicySummaryPanelProps {
  policyName: string;
  scope: string;
  mode: string;
  priority: string;
  status: string;
  assignedApp: string;
  selectedGroups: string[];
  onCreatePolicy: () => void;
  onSaveDraft: () => void;
}

export function PolicySummaryPanel({
  policyName,
  scope,
  mode,
  priority,
  status,
  assignedApp,
  selectedGroups,
  onCreatePolicy,
  onSaveDraft,
}: PolicySummaryPanelProps) {
  const isNameValid = policyName.trim().length > 0;
  const isScopeValid = scope.trim().length > 0;
  const hasRules = selectedGroups.length > 0;
  const isFormValid = isNameValid && isScopeValid && hasRules;

  return (
    <div className="xl:col-span-4 bg-[#0B1320] border border-[#172338] p-4 space-y-4 font-mono">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#172338]">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-400" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider font-sans">
            Policy Summary
          </h3>
        </div>
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700 uppercase">
          {status}
        </span>
      </div>

      {/* Overview Group */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-[#172338]/60 font-sans">
          Overview
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Scope:</span>
            <span className="text-slate-200 font-bold">{scope || '—'}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Mode:</span>
            <span
              className={`px-1.5 py-0.5 text-[10px] font-bold border uppercase ${
                mode === 'Blocking'
                  ? 'bg-rose-950 text-rose-300 border-rose-800'
                  : 'bg-blue-950 text-blue-300 border-blue-800'
              }`}
            >
              {mode}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Priority:</span>
            <span
              className={`font-bold ${
                priority === 'Critical' || priority === 'High'
                  ? 'text-rose-400'
                  : 'text-amber-400'
              }`}
            >
              {priority}
            </span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Selected Rule Groups:</span>
            <span className="text-slate-200 font-bold">{selectedGroups.length}</span>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <span className="text-slate-400">Estimated Assignments:</span>
            <span className="text-slate-300 text-[11px]">{assignedApp ? `1 application` : 'None'}</span>
          </div>
        </div>
      </div>

      {/* Selected Rule Groups List */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-[#172338]/60 font-sans">
          Selected Rule Groups ({selectedGroups.length})
        </h4>
        <div className="space-y-1.5 pt-1 max-h-44 overflow-y-auto pr-1">
          {selectedGroups.length === 0 ? (
            <div className="text-[11px] text-slate-500 italic py-1">
              No rule groups selected
            </div>
          ) : (
            selectedGroups.map((group) => (
              <div key={group} className="flex items-center gap-2 text-slate-300 py-0.5">
                <div className="w-3.5 h-3.5 bg-emerald-950 border border-emerald-700 flex items-center justify-center text-emerald-400 shrink-0">
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </div>
                <span className="truncate text-xs">{group}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Validation Checklist */}
      <div className="space-y-2 text-xs">
        <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-[#172338]/60 font-sans">
          Validation
        </h4>
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center gap-2 text-xs">
            <div
              className={`w-3.5 h-3.5 border flex items-center justify-center ${
                isNameValid
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                  : 'bg-[#152030] border-[#25354D] text-slate-500'
              }`}
            >
              {isNameValid && <Check className="w-2.5 h-2.5 stroke-[3]" />}
            </div>
            <span className={isNameValid ? 'text-slate-300' : 'text-slate-500'}>
              Name provided
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div
              className={`w-3.5 h-3.5 border flex items-center justify-center ${
                isScopeValid
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                  : 'bg-[#152030] border-[#25354D] text-slate-500'
              }`}
            >
              {isScopeValid && <Check className="w-2.5 h-2.5 stroke-[3]" />}
            </div>
            <span className={isScopeValid ? 'text-slate-300' : 'text-slate-500'}>
              Scope defined
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div
              className={`w-3.5 h-3.5 border flex items-center justify-center ${
                hasRules
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                  : 'bg-[#152030] border-[#25354D] text-slate-500'
              }`}
            >
              {hasRules && <Check className="w-2.5 h-2.5 stroke-[3]" />}
            </div>
            <span className={hasRules ? 'text-slate-300' : 'text-slate-500'}>
              At least one rule group selected
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div
              className={`w-3.5 h-3.5 border flex items-center justify-center ${
                isFormValid
                  ? 'bg-emerald-950 border-emerald-700 text-emerald-400'
                  : 'bg-[#152030] border-[#25354D] text-slate-500'
              }`}
            >
              {isFormValid && <Check className="w-2.5 h-2.5 stroke-[3]" />}
            </div>
            <span className={isFormValid ? 'text-slate-300' : 'text-slate-500'}>
              Ready to save as draft
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 pt-2 border-t border-[#172338]">
        <button
          type="button"
          onClick={onCreatePolicy}
          disabled={!isFormValid}
          className="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2.5 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Plus className="w-4 h-4" />
          <span>Create Policy</span>
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onSaveDraft}
            className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
          >
            <Save className="w-3.5 h-3.5 text-slate-400" />
            <span>Save Draft</span>
          </button>

          <Link
            to="/policies"
            className="bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider text-center"
          >
            <X className="w-3.5 h-3.5 text-slate-400" />
            <span>Cancel</span>
          </Link>
        </div>

        <button
          type="button"
          className="w-full bg-[#0E1726] hover:bg-[#142034] text-slate-200 border border-[#1C293D] text-xs font-medium px-3 py-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-sans uppercase tracking-wider"
        >
          <Play className="w-3.5 h-3.5 text-slate-400" />
          <span>Preview Policy</span>
        </button>
      </div>
    </div>
  );
}
