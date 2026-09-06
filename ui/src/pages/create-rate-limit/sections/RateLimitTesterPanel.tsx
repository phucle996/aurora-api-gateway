import React, { useState } from 'react';
import { Play, CheckCircle2, AlertCircle } from 'lucide-react';

interface RateLimitTesterProps {
  rateLimit: number;
}

export function RateLimitTesterPanel({ rateLimit }: RateLimitTesterProps) {
  const [testIp, setTestIp] = useState('203.0.113.10');
  const [testPath, setTestPath] = useState('/login');
  const [simCount, setSimCount] = useState(3);
  const [testing, setTesting] = useState(false);

  const handleSendTest = () => {
    setTesting(true);
    setTimeout(() => {
      setSimCount((prev) => (prev >= rateLimit + 2 ? 1 : prev + 1));
      setTesting(false);
    }, 200);
  };

  const isAllowed = simCount <= rateLimit;

  return (
    <div className="bg-card border border-border p-4 space-y-3 font-sans text-xs">
      <div>
        <div className="text-sm font-semibold text-foreground">Test Rule</div>
        <p className="text-muted-foreground text-[11px] font-sans">
          Simulate requests to see how the rate limit works.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
        {/* Client IP */}
        <div className="sm:col-span-5">
          <label className="block text-muted-foreground mb-1 text-[11px]">Client IP</label>
          <input
            type="text"
            value={testIp}
            onChange={(e) => setTestIp(e.target.value)}
            className="w-full bg-background border border-input px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary text-xs"
          />
        </div>

        {/* Request Path */}
        <div className="sm:col-span-4">
          <label className="block text-muted-foreground mb-1 text-[11px]">Request Path</label>
          <input
            type="text"
            value={testPath}
            onChange={(e) => setTestPath(e.target.value)}
            className="w-full bg-background border border-input px-2.5 py-1.5 text-foreground focus:outline-none focus:border-primary text-xs"
          />
        </div>

        {/* Send Test Button */}
        <div className="sm:col-span-3">
          <button
            type="button"
            onClick={handleSendTest}
            disabled={testing}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold cursor-pointer transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>{testing ? 'Sending...' : 'Send Test'}</span>
          </button>
        </div>
      </div>

      {/* Result Status Banner */}
      <div
        className={`p-2.5 border flex items-center gap-2 text-xs ${
          isAllowed
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
            : 'bg-destructive/10 border-destructive/30 text-destructive'
        }`}
      >
        {isAllowed ? (
          <CheckCircle2 className="w-4 h-4 shrink-0" />
        ) : (
          <AlertCircle className="w-4 h-4 shrink-0" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {isAllowed ? 'Request allowed' : 'Request blocked (HTTP 429)'}
          </span>
          <span className="text-muted-foreground text-[11px]">
            Current count: {simCount} / {rateLimit} ({isAllowed ? 'within limit' : 'rate exceeded'})
          </span>
        </div>
      </div>
    </div>
  );
}
