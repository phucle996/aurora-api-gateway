import React from 'react';
import { Link } from 'react-router-dom';
import { History, Copy, Trash2, Save, ChevronRight } from 'lucide-react';

interface EditRuleHeaderProps {
  onDuplicate: () => void;
  onDelete: () => void;
  onSave: () => void;
  isSaving: boolean;
}

export function EditRuleHeader({
  onDuplicate,
  onDelete,
  onSave,
  isSaving,
}: EditRuleHeaderProps) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
      <div>
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500 mb-1">
          <Link to="/rules" className="hover:text-slate-300 transition-colors">
            Rules
          </Link>
          <ChevronRight className="w-3 h-3 text-slate-600" />
          <span className="text-slate-300">Edit Rule</span>
        </div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-white tracking-tight">
          Edit Security Rule
        </h1>
        <p className="text-xs text-slate-400 mt-1 font-mono">
          Modify the rule configuration and deploy changes to protect your applications.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
        <button
          type="button"
          onClick={() => alert('Viewing rule revision history (v1, v2, v3)...')}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-200 hover:text-white transition-colors cursor-pointer"
        >
          <History className="w-3.5 h-3.5 text-cyan-400" />
          <span>View Rule History</span>
        </button>

        <button
          type="button"
          onClick={onDuplicate}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-200 hover:text-white transition-colors cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5 text-slate-400" />
          <span>Duplicate</span>
        </button>

        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0E1726] hover:bg-rose-950/40 border border-rose-950 hover:border-rose-700/60 text-rose-400 transition-colors cursor-pointer"
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
