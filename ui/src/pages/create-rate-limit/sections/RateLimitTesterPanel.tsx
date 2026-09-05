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
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-3 font-mono text-xs">
      <div>
        <div className="text-sm font-semibold text-white">Test Rule</div>
        <p className="text-slate-400 text-[11px] font-sans">
          Simulate requests to see how the rate limit works.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
        {/* Client IP */}
        <div className="sm:col-span-5">
          <label className="block text-slate-400 mb-1 text-[11px]">Client IP</label>
          <input
            type="text"
            value={testIp}
            onChange={(e) => setTestIp(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500 text-xs"
          />
        </div>

        {/* Request Path */}
        <div className="sm:col-span-4">
          <label className="block text-slate-400 mb-1 text-[11px]">Request Path</label>
          <input
            type="text"
            value={testPath}
            onChange={(e) => setTestPath(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500 text-xs"
          />
        </div>

        {/* Send Test Button */}
        <div className="sm:col-span-3">
          <button
            type="button"
            onClick={handleSendTest}
            disabled={testing}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer transition-colors"
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
            ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
            : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
        }`}
      >
        {isAllowed ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : (
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">
            {isAllowed ? 'Request allowed' : 'Request blocked (HTTP 429)'}
          </span>
          <span className="text-slate-400 text-[11px]">
            Current count: {simCount} / {rateLimit} ({isAllowed ? 'within limit' : 'rate exceeded'})
          </span>
        </div>
      </div>
    </div>
  );
}
