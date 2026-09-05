import React from 'react';
import { HelpCircle } from 'lucide-react';

interface RateLimitBasicInfoProps {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  policy: string;
  setPolicy: (v: string) => void;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  priority: number;
  setPriority: (v: number) => void;
}

export function RateLimitBasicInfoSection({
  name,
  setName,
  description,
  setDescription,
  policy,
  setPolicy,
  enabled,
  setEnabled,
  priority,
  setPriority,
}: RateLimitBasicInfoProps) {
  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div className="text-sm font-semibold text-white">
        1. Basic Information
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Rule Name */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Rule Name <span className="text-rose-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="limit-login-attempts"
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Limit login requests to prevent brute force attacks."
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        {/* Policy */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Policy
          </label>
          <select
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="Default Policy">Default Policy</option>
            <option value="API Gateway Policy">API Gateway Policy</option>
            <option value="Admin Security Policy">Admin Security Policy</option>
            <option value="E-Commerce Edge Policy">E-Commerce Edge Policy</option>
          </select>
        </div>

        {/* Status */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Status
          </label>
          <div className="flex items-center gap-2.5 h-[34px]">
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className={`w-9 h-5 flex items-center p-0.5 cursor-pointer transition-colors ${
                enabled ? 'bg-blue-600' : 'bg-[#152030]'
              }`}
            >
              <div
                className={`w-4 h-4 bg-white transition-transform ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={enabled ? 'text-blue-400' : 'text-slate-500'}>
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Priority */}
        <div>
          <div className="flex items-center gap-1 text-slate-400 mb-1 text-[11px]">
            <span>Priority</span>
            <HelpCircle className="w-3 h-3 text-slate-500 cursor-pointer" />
          </div>
          <input
            type="number"
            value={priority}
            onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>
    </div>
  );
}
