import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export function CreateIpRuleHeader() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        {/* Breadcrumbs */}
        <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500 mb-1">
          <Link to="/ip-access" className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors">
            IP & Access Control
          </Link>
          <ChevronRight className="w-3 h-3 text-slate-400 dark:text-slate-600" />
          <span className="text-slate-700 dark:text-slate-300">Add Rule</span>
        </div>

        {/* Title */}
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
          Add IP & Access Control Rule
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
          Control which IP addresses, networks, or regions can access your services.
        </p>
      </div>

      <div>
        <Link
          to="/ip-access"
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-xs font-mono text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
          <span>Back to IP & Access Control</span>
        </Link>
      </div>
    </div>
  );
}
