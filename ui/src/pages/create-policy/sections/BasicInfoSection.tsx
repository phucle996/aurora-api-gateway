import React, { useRef, useEffect } from 'react';
import { Shield, Info, Eye, ShieldAlert } from 'lucide-react';

export type PolicyMode = 'mixed' | 'block' | 'detect';

interface BasicInfoSectionProps {
  name: string;
  setName: (val: string) => void;
  description: string;
  setDescription: (val: string) => void;
  mode: PolicyMode;
  setMode: (val: PolicyMode) => void;
  priority: number;
  setPriority: (val: number) => void;
}

const MAX_DESCRIPTION_LENGTH = 500;

export function BasicInfoSection({
  name,
  setName,
  description,
  setDescription,
  mode,
  setMode,
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
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-sans text-xs">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
        1. Basic Information
      </h2>

      <div className="space-y-4">
        {/* Row 1: Policy Name & Priority */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Policy Name */}
          <div className="space-y-1.5">
            <label className="block text-slate-700 dark:text-slate-300 font-medium">
              Policy Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              maxLength={120}
              placeholder="e.g. production-api"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Priority */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
              <span>Evaluation Priority</span>
              <span
                className="cursor-help text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Policies are evaluated in order of priority (0–1,000,000). Lower numbers have higher precedence."
              >
                <Info className="w-3 h-3" />
              </span>
            </label>
            <input
              type="number"
              min={0}
              max={1000000}
              value={priority}
              onChange={(e) => setPriority(Math.max(0, Math.min(1000000, Number(e.target.value) || 0)))}
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs tabular-nums rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>
        </div>

        {/* Row 2: Enforcement Mode Cards */}
        <div className="space-y-2">
          <label className="flex items-center gap-1 text-slate-700 dark:text-slate-300 font-medium">
            <span>Enforcement Mode</span>
            <span
              className="cursor-help text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="Controls how attached rules are executed by the cluster runtime."
            >
              <Info className="w-3 h-3" />
            </span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Mixed Mode */}
            <div
              onClick={() => setMode('mixed')}
              className={`p-3 border rounded-sm cursor-pointer transition-all ${
                mode === 'mixed'
                  ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                  : 'border-slate-200 dark:border-[#1C293D] hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-[#080E18]/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Shield className={`w-3.5 h-3.5 ${mode === 'mixed' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                <span className={`font-semibold ${mode === 'mixed' ? 'text-blue-900 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'}`}>
                  Mixed (Default)
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                Enforces individual actions configured on each rule (Block, Allow, Throttle).
              </p>
            </div>

            {/* Block Mode */}
            <div
              onClick={() => setMode('block')}
              className={`p-3 border rounded-sm cursor-pointer transition-all ${
                mode === 'block'
                  ? 'border-rose-500 bg-rose-50/40 dark:bg-rose-950/30'
                  : 'border-slate-200 dark:border-[#1C293D] hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-[#080E18]/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert className={`w-3.5 h-3.5 ${mode === 'block' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`} />
                <span className={`font-semibold ${mode === 'block' ? 'text-rose-900 dark:text-rose-300' : 'text-slate-800 dark:text-slate-200'}`}>
                  Strict Block
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                Immediately blocks all matching rule violations across the policy scope.
              </p>
            </div>

            {/* Detect Mode */}
            <div
              onClick={() => setMode('detect')}
              className={`p-3 border rounded-sm cursor-pointer transition-all ${
                mode === 'detect'
                  ? 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/30'
                  : 'border-slate-200 dark:border-[#1C293D] hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-[#080E18]/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Eye className={`w-3.5 h-3.5 ${mode === 'detect' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`} />
                <span className={`font-semibold ${mode === 'detect' ? 'text-amber-900 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'}`}>
                  Detect (Shadow)
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                Logs rule violations without blocking traffic. Ideal for pre-production evaluation.
              </p>
            </div>
          </div>
        </div>

        {/* Row 3: Description */}
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
            placeholder="Security policy description and intended operational boundary..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs rounded-sm focus:outline-none focus:border-blue-500 transition-colors resize-none overflow-hidden min-h-[64px]"
          />
        </div>
      </div>
    </section>
  );
}

export default BasicInfoSection;
