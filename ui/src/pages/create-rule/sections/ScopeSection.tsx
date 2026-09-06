import React from 'react';

interface ScopeProps {
  sourceIP: string;
  setSourceIP: (v: string) => void;
  hostDomain: string;
  setHostDomain: (v: string) => void;
  pathPrefix: string;
  setPathPrefix: (v: string) => void;
  httpMethod: string;
  setHttpMethod: (v: string) => void;
}

export function ScopeSection({
  sourceIP,
  setSourceIP,
  hostDomain,
  setHostDomain,
  pathPrefix,
  setPathPrefix,
  httpMethod,
  setHttpMethod,
}: ScopeProps) {
  return (
    <div className="bg-card border border-border p-4 space-y-4 font-sans text-xs">
      <div>
        <div className="text-sm font-semibold text-foreground">
          4. Scope (Optional)
        </div>
        <p className="text-muted-foreground text-[11px] mt-0.5 font-sans">
          Limit when this rule is applied.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        {/* Source IP */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">Source IP</label>
          <input
            type="text"
            value={sourceIP}
            aria-label="Source IP scope"
            maxLength={2048}
            onChange={(e) => setSourceIP(e.target.value)}
            placeholder="e.g. 10.0.0.0/8, 192.168.1.1"
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
          />
        </div>

        {/* Host / Domain */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">Host / Domain</label>
          <input
            type="text"
            value={hostDomain}
            aria-label="Host scope"
            maxLength={253}
            onChange={(e) => setHostDomain(e.target.value)}
            placeholder="e.g. example.com"
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
          />
        </div>

        {/* Path Prefix */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">Path Prefix</label>
          <input
            type="text"
            value={pathPrefix}
            aria-label="Path prefix scope"
            maxLength={8192}
            onChange={(e) => setPathPrefix(e.target.value)}
            placeholder="e.g. /api"
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary"
          />
        </div>

        {/* HTTP Method */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">HTTP Method</label>
          <select
            value={httpMethod}
            aria-label="HTTP method scope"
            onChange={(e) => setHttpMethod(e.target.value)}
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
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
