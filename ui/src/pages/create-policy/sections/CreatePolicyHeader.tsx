import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface CreatePolicyHeaderProps {
  isEditing?: boolean;
}

export function CreatePolicyHeader({ isEditing }: CreatePolicyHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-[#152030]">
      <div>
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1.5 text-xs font-sans text-slate-500 dark:text-slate-400 mb-1">
          <Link
            to="/policies"
            className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
          >
            Policies
          </Link>
          <span>/</span>
          <span className="text-slate-800 dark:text-slate-200 font-medium">
            {isEditing ? 'Edit Policy' : 'Create Policy'}
          </span>
        </nav>

        {/* Title & Subtitle */}
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {isEditing ? 'Edit Security Policy' : 'Create Security Policy'}
        </h1>
        <p className="text-xs font-sans text-slate-500 dark:text-slate-400 mt-1">
          Define a set of rules and actions to protect your applications.
        </p>
      </div>

      {/* Back to Policies Button */}
      <Link
        to="/policies"
        className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-white dark:bg-[#0B1320] hover:bg-slate-50 dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-300 text-xs font-sans transition-colors rounded-sm shadow-xs shrink-0 self-start sm:self-auto"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Policies</span>
      </Link>
    </div>
  );
}

export default CreatePolicyHeader;
