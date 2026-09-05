import React, { useState } from 'react';
import { Target, ChevronDown, X, Plus } from 'lucide-react';

interface ScopeAssignmentSectionProps {
  hostScope: string;
  onHostScopeChange: (val: string) => void;
  pathPattern: string;
  onPathPatternChange: (val: string) => void;
  assignedApp: string;
  onAssignedAppChange: (val: string) => void;
  tags: string[];
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}

export function ScopeAssignmentSection({
  hostScope,
  onHostScopeChange,
  pathPattern,
  onPathPatternChange,
  assignedApp,
  onAssignedAppChange,
  tags,
  onAddTag,
  onRemoveTag,
}: ScopeAssignmentSectionProps) {
  const [newTagInput, setNewTagInput] = useState('');

  const handleAddTagKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTagInput.trim()) {
      e.preventDefault();
      onAddTag(newTagInput.trim());
      setNewTagInput('');
    }
  };

  return (
    <div className="bg-[#0B1320] border border-[#172338] p-5 space-y-4">
      {/* Section Header */}
      <div className="flex items-start gap-2.5 pb-2 border-b border-[#172338]">
        <div className="w-7 h-7 bg-[#0E1B2C] border border-[#1C3252] flex items-center justify-center text-slate-300">
          <Target className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
            Scope & Assignment
          </h2>
          <p className="text-[11px] text-slate-400 font-mono">
            Define where this policy applies and assign to protected applications.
          </p>
        </div>
      </div>

      {/* Form Fields */}
      <div className="space-y-3 font-mono text-xs">
        {/* Host / Scope & Path Pattern */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="hostScope"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Host / Scope <span className="text-rose-400">*</span>
            </label>
            <input
              id="hostScope"
              type="text"
              value={hostScope}
              onChange={(e) => onHostScopeChange(e.target.value)}
              placeholder="e.g. admin.aurora.local"
              className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              required
            />
          </div>

          <div>
            <label
              htmlFor="pathPattern"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Path Pattern <span className="text-rose-400">*</span>
            </label>
            <input
              id="pathPattern"
              type="text"
              value={pathPattern}
              onChange={(e) => onPathPatternChange(e.target.value)}
              placeholder="e.g. /admin/*"
              className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
              required
            />
          </div>
        </div>

        {/* Assigned Application & Tags */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="assignedApp"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Assigned Application <span className="text-rose-400">*</span>
            </label>
            <div className="relative">
              <select
                id="assignedApp"
                value={assignedApp}
                onChange={(e) => onAssignedAppChange(e.target.value)}
                className="w-full appearance-none bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
              >
                <option value="Administrative Console">Administrative Console</option>
                <option value="API Gateway">API Gateway</option>
                <option value="Customer Portal">Customer Portal</option>
                <option value="Auth Service">Auth Service</option>
                <option value="Static Assets CDN">Static Assets CDN</option>
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div>
            <label
              htmlFor="tagsInput"
              className="block text-[11px] uppercase tracking-wider text-slate-300 mb-1"
            >
              Tags
            </label>
            <div className="flex flex-wrap items-center gap-1.5 bg-[#0E1726] border border-[#1C293D] p-1.5 min-h-[34px]">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#172338] border border-[#233550] text-emerald-300 text-[10px]"
                >
                  <span>{tag}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveTag(tag)}
                    className="hover:text-white cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              ))}
              <input
                id="tagsInput"
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={handleAddTagKey}
                placeholder="Add tag..."
                className="bg-transparent border-none text-white text-[11px] placeholder:text-slate-500 focus:outline-none flex-1 min-w-[80px]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
