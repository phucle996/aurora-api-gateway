import React from 'react';
import { Link } from 'react-router-dom';
import { History, Trash2, Save, ChevronRight } from 'lucide-react';

interface EditRuleHeaderProps {
  ruleId?: string;
  onDuplicate?: () => void;
  onDelete: () => void;
  onSave: () => void;
  isSaving: boolean;
}

export function EditRuleHeader({
  ruleId,
  onDelete,
  onSave,
  isSaving,
}: EditRuleHeaderProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500 mb-1">
          <Link to="/rules" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            Rules
          </Link>
          <ChevronRight className="w-3 h-3 text-slate-400 dark:text-slate-600" />
          <span className="text-slate-700 dark:text-slate-300">Edit Rule</span>
        </div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
          Edit Security Rule
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
          Modify the rule configuration and deploy changes to protect your applications.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
        <Link
          to={`/rules/history?id=${ruleId || 'rule_01H8F3K9Z7'}`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
        >
          <History className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          <span>View Rule History</span>
        </Link>

        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-[#0E1726] dark:hover:bg-rose-950/40 border border-rose-200 dark:border-rose-950 hover:border-rose-300 dark:hover:border-rose-700/60 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete</span>
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white font-bold transition-colors cursor-pointer shadow-sm"
        >
          <Save className="w-3.5 h-3.5" />
          <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
        </button>
      </div>
    </div>
  );
}
