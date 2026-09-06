import React from 'react';
import { Link } from 'react-router-dom';
import { LayoutTemplate, ChevronRight } from 'lucide-react';

interface CreateRuleHeaderProps {
  onScrollToTemplates: () => void;
}

export function CreateRuleHeader({ onScrollToTemplates }: CreateRuleHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-sans text-slate-500 mb-1">
          <Link to="/rules" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            Rules
          </Link>
          <ChevronRight className="w-3 h-3 text-slate-400 dark:text-slate-600" />
          <span className="text-slate-700 dark:text-slate-300">Create Rule</span>
        </div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
          Create Security Rule
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Define conditions and actions to protect your applications from malicious traffic.
        </p>
      </div>

      <div>
        <button
          type="button"
          onClick={onScrollToTemplates}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-xs font-sans text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white transition-colors cursor-pointer"
        >
          <LayoutTemplate className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          <span>View Rule Templates</span>
        </button>
      </div>
    </div>
  );
}
