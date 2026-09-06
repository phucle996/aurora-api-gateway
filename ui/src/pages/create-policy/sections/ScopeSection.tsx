import React from 'react';

interface ScopeSectionProps {
  target: string;
  setTarget: (val: string) => void;
  path: string;
  setPath: (val: string) => void;
  httpMethod: string;
  setHttpMethod: (val: string) => void;
}

export function ScopeSection({
  target,
  setTarget,
  path,
  setPath,
  httpMethod,
  setHttpMethod,
}: ScopeSectionProps) {
  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 space-y-4 shadow-xs rounded-sm font-mono">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          3. Scope
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Define where this policy will be applied.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {/* Target (Domains) */}
        <div className="space-y-1.5">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            Target
          </label>
          <input
            type="text"
            required
            placeholder="* (All Domains) or host (e.g. api.yourdomain.com)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs font-mono rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* Path Prefix */}
        <div className="space-y-1.5">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            Path
          </label>
          <input
            type="text"
            required
            placeholder="/api/*"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs font-mono rounded-sm focus:outline-none focus:border-blue-500 transition-colors"
          />
        </div>

        {/* HTTP Method */}
        <div className="space-y-1.5">
          <label className="block text-slate-700 dark:text-slate-300 font-medium">
            HTTP Method
          </label>
          <div className="relative">
            <select
              value={httpMethod}
              onChange={(e) => setHttpMethod(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#1C293D] px-3 py-2 text-slate-900 dark:text-white text-xs font-mono rounded-sm focus:outline-none focus:border-blue-500 cursor-pointer appearance-none"
            >
              <option value="*">All Methods</option>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="PATCH">PATCH</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-[10px]">
              ▼
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ScopeSection;
