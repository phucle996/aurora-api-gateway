import React from 'react';

interface EditScopeProps {
  sourceIP: string;
  setSourceIP: (v: string) => void;
  hostDomain: string;
  setHostDomain: (v: string) => void;
  pathPrefix: string;
  setPathPrefix: (v: string) => void;
  httpMethod: string;
  setHttpMethod: (v: string) => void;
}

export function EditScopeSection({
  sourceIP,
  setSourceIP,
  hostDomain,
  setHostDomain,
  pathPrefix,
  setPathPrefix,
  httpMethod,
  setHttpMethod,
}: EditScopeProps) {
  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div>
        <div className="text-sm font-semibold text-white">
          4. Scope (Optional)
        </div>
        <p className="text-slate-400 text-[11px] mt-0.5 font-sans">
          Limit when this rule is applied.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {/* Source IP */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">Source IP</label>
          <input
            type="text"
            value={sourceIP}
            onChange={(e) => setSourceIP(e.target.value)}
            placeholder="e.g. 10.0.0.0/8, 192.168.1.1"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Host / Domain */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">Host / Domain</label>
          <input
            type="text"
            value={hostDomain}
            onChange={(e) => setHostDomain(e.target.value)}
            placeholder="e.g. example.com"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Path Prefix */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">Path Prefix</label>
          <input
            type="text"
            value={pathPrefix}
            onChange={(e) => setPathPrefix(e.target.value)}
            placeholder="e.g. /api"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* HTTP Method */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">HTTP Method</label>
          <select
            value={httpMethod}
            onChange={(e) => setHttpMethod(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="All Methods">All Methods</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>
        </div>
      </div>
    </div>
  );
}
