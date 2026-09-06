import React, { useRef, useEffect } from 'react';
import { Shield, Info, Gauge, GlobeLock } from 'lucide-react';

export type PolicyType = 'waf' | 'rate-limit' | 'access-control';

interface BasicInfoSectionProps {
  name: string;
  setName: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  policyType: PolicyType;
  setPolicyType: (val: PolicyType) => void;
  enabled: boolean;
  setEnabled: (val: boolean) => void;
  priority: number;
  setPriority: (val: number) => void;
}

const MAX_DESCRIPTION_LENGTH = 500;

export function BasicInfoSection({
  name,
  setName,
  description,
  setDescription,
  policyType,
  setPolicyType,
  enabled,
  setEnabled,
  priority,
  setPriority,
}: BasicInfoSectionProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height to fit content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(64, textareaRef.current.scrollHeight)}px`;
    }
  }, [description]);

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-mono text-xs">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        1. Basic Information
      </h2>

      <div className="space-y-4">
        {/* Tầng 1: Policy Name & Policy Type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Policy Name */}
          <div className="space-y-1.5">
            <label className="block text-slate-700 dark:text-slate-300 font-medium">
              Policy Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. production-api"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs font-mono rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Policy Type */}
          <div className="space-y-1.5">
            <label className="block text-slate-700 dark:text-slate-300 font-medium">
              Policy Type <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                {policyType === 'waf' && <Shield className="w-3.5 h-3.5 text-blue-500" />}
                {policyType === 'rate-limit' && <Gauge className="w-3.5 h-3.5 text-cyan-500" />}
                {policyType === 'access-control' && <GlobeLock className="w-3.5 h-3.5 text-amber-500" />}
              </div>
              <select
                value={policyType}
                onChange={(e) => setPolicyType(e.target.value as PolicyType)}
                className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] pl-9 pr-8 py-2 text-slate-900 dark:text-white text-xs font-mono rounded-sm focus:outline-none focus:border-blue-500 cursor-pointer appearance-none"
              >
                <option value="waf">WAF Policy</option>
                <option value="rate-limit">Rate Limiting Policy</option>
                <option value="access-control">Access Control Policy</option>
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px]">
                ▼
              </div>
            </div>
          </div>
        </div>

        {/* Tầng 2: Status & Priority */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          {/* Status */}
          <div className="space-y-1.5">
            <label className="block text-slate-700 dark:text-slate-300 font-medium">
              Status
            </label>
            <div className="flex items-center gap-2.5 h-[34px]">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled(!enabled)}
                className={`w-10 h-5.5 flex items-center p-0.5 rounded-full cursor-pointer transition-colors ${
                  enabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-[#1C293D]'
                }`}
              >
                <div
                  className={`w-4.5 h-4.5 bg-white rounded-full transition-transform shadow-xs ${
                    enabled ? 'translate-x-4.5' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-slate-800 dark:text-slate-200 text-xs font-medium">
                {enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
              <span>Priority</span>
              <span
                className="cursor-help text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Policies are evaluated in order of priority. Lower numbers have higher priority."
              >
                <Info className="w-3 h-3" />
              </span>
            </label>
            <input
              type="number"
              min={1}
              max={1000000}
              value={priority}
              onChange={(e) => setPriority(Math.max(1, Number(e.target.value) || 1))}
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs font-mono rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Tầng 3: Description with character limit and auto-height textarea */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-slate-700 dark:text-slate-300 font-medium">
              Description
            </label>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
              {description.length}/{MAX_DESCRIPTION_LENGTH}
            </span>
          </div>
          <textarea
            ref={textareaRef}
            rows={2}
            maxLength={MAX_DESCRIPTION_LENGTH}
            placeholder="Security policy for production API endpoints..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs font-mono rounded-sm focus:outline-none focus:border-blue-500 transition-colors resize-none overflow-hidden min-h-[64px]"
          />
        </div>
      </div>
    </section>
  );
}

export default BasicInfoSection;
