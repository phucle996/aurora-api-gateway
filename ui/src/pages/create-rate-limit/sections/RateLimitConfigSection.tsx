import React from 'react';
import { User, Key, Users, Code } from 'lucide-react';

export type LimitDimension = 'ip' | 'api_key' | 'user' | 'path';

interface RateLimitConfigProps {
  dimension: LimitDimension;
  setDimension: (d: LimitDimension) => void;
  rateLimit: number;
  setRateLimit: (n: number) => void;
  rateUnit: string;
  setRateUnit: (u: string) => void;
  burst: number;
  setBurst: (n: number) => void;
  actionExceeded: string;
  setActionExceeded: (a: string) => void;
  customResponse: boolean;
  setCustomResponse: (v: boolean) => void;
  responseCode: string;
  setResponseCode: (v: string) => void;
  responseBody: string;
  setResponseBody: (v: string) => void;
}

export function RateLimitConfigSection({
  dimension,
  setDimension,
  rateLimit,
  setRateLimit,
  rateUnit,
  setRateUnit,
  burst,
  setBurst,
  actionExceeded,
  setActionExceeded,
  customResponse,
  setCustomResponse,
  responseCode,
  setResponseCode,
  responseBody,
  setResponseBody,
}: RateLimitConfigProps) {
  const tabs: Array<{ id: LimitDimension; label: string; icon: React.ReactNode }> = [
    { id: 'ip', label: 'By IP', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'api_key', label: 'By API Key', icon: <Key className="w-3.5 h-3.5" /> },
    { id: 'user', label: 'By User', icon: <Users className="w-3.5 h-3.5" /> },
    { id: 'path', label: 'By Path', icon: <Code className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-sans text-xs">
      <div>
        <div className="text-sm font-semibold text-white">
          2. Rate Limit Configuration
        </div>
        <p className="text-slate-400 text-[11px] mt-0.5 font-sans">
          Define the request rate and behavior when the limit is exceeded.
        </p>
      </div>

      {/* Limiting Dimension Tabs */}
      <div className="flex border-b border-[#152030] bg-[#080E18] overflow-x-auto">
        {tabs.map((tab) => {
          const active = dimension === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setDimension(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 transition-colors cursor-pointer whitespace-nowrap text-xs ${
                active
                  ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-[#0E1726]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Rate, Burst & Action */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* Rate Limit */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Rate Limit <span className="text-rose-400">*</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={rateLimit}
              onChange={(e) => setRateLimit(parseInt(e.target.value) || 0)}
              className="w-20 bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
            />
            <span className="text-slate-400 text-[11px] shrink-0">requests per</span>
            <select
              value={rateUnit}
              onChange={(e) => setRateUnit(e.target.value)}
              className="bg-[#0E1726] border border-[#1C293D] px-2 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer text-xs"
            >
              <option value="1 minute">1 minute</option>
              <option value="1 second">1 second</option>
              <option value="1 hour">1 hour</option>
            </select>
          </div>
        </div>

        {/* Burst */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Burst (Optional)
          </label>
          <input
            type="number"
            value={burst}
            onChange={(e) => setBurst(parseInt(e.target.value) || 0)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
          />
          <span className="text-slate-500 text-[10px] mt-0.5 block">
            Allow short bursts above the rate limit.
          </span>
        </div>

        {/* Action When Exceeded */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Action When Exceeded <span className="text-rose-400">*</span>
          </label>
          <select
            value={actionExceeded}
            onChange={(e) => setActionExceeded(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer text-xs"
          >
            <option value="block_429">🚫 Block Request (HTTP 429)</option>
            <option value="challenge">🛡 Challenge (Captcha)</option>
            <option value="log_only">📝 Log Only / Monitor</option>
            <option value="drop">⛔ Drop Connection (TCP RST)</option>
          </select>
        </div>
      </div>

      {/* Return Custom Response Checkbox & Subform */}
      <div className="space-y-3 pt-2 border-t border-[#152030]">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={customResponse}
            onChange={(e) => setCustomResponse(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-[#0E1726] border border-[#1C293D] text-blue-600 focus:ring-0 cursor-pointer"
          />
          <div>
            <div className="text-white font-medium text-xs">Return custom response</div>
            <div className="text-slate-400 text-[11px] font-sans mt-0.5">
              Send a custom response when rate limit is exceeded.
            </div>
          </div>
        </label>

        {customResponse && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6 pt-1">
            {/* Response Code */}
            <div>
              <label className="block text-slate-400 mb-1 text-[11px]">
                Response Code
              </label>
              <select
                value={responseCode}
                onChange={(e) => setResponseCode(e.target.value)}
                className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer text-xs"
              >
                <option value="429">429 Too Many Requests</option>
                <option value="403">403 Forbidden</option>
                <option value="503">503 Service Unavailable</option>
                <option value="200">200 OK (Custom Payload)</option>
              </select>
            </div>

            {/* Response Body (JSON) */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-slate-400 text-[11px]">
                  Response Body (JSON)
                </label>
                <span className="text-slate-500 text-[10px]">
                  {responseBody.length}/512
                </span>
              </div>
              <textarea
                value={responseBody}
                onChange={(e) => setResponseBody(e.target.value)}
                rows={4}
                maxLength={512}
                className="w-full bg-[#0E1726] border border-[#1C293D] p-2.5 text-slate-300 font-mono text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
