import React from 'react';

interface IpScopeProps {
  target: string;
  setTarget: (v: string) => void;
  path: string;
  setPath: (v: string) => void;
  method: string;
  setMethod: (v: string) => void;
  timeWindow: string;
  setTimeWindow: (v: string) => void;
}

export function IpScopeSection({
  target,
  setTarget,
  path,
  setPath,
  method,
  setMethod,
  timeWindow,
  setTimeWindow,
}: IpScopeProps) {
  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div>
        <div className="text-sm font-semibold text-white">
          3. Scope (Optional)
        </div>
        <p className="text-slate-400 text-[11px] mt-0.5 font-sans">
          Limit where this rule is applied across domains, endpoints, or time schedules.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Target */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">Target</label>
          <input
            type="text"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="* (All Sites) or host"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 text-xs"
          />
        </div>

        {/* Path (URL Path) */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">Path (URL Path)</label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="e.g. /admin (optional)"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 text-xs"
          />
        </div>

        {/* HTTP Method */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">HTTP Method</label>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer text-xs"
          >
            <option value="*">All Methods</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>
        </div>

        {/* Time Window */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">Time Window</label>
          <select
            value={timeWindow}
            onChange={(e) => setTimeWindow(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer text-xs"
          >
            <option value="always">Always</option>
            <option value="business_hours">Business Hours (09:00 - 18:00 UTC)</option>
            <option value="weekend">Weekends Only</option>
            <option value="night">Night Time (22:00 - 06:00 UTC)</option>
          </select>
        </div>
      </div>
    </div>
  );
}
