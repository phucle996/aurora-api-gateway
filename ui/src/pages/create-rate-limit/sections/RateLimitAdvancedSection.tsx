import React from 'react';

interface RateLimitAdvancedProps {
  logEvents: boolean;
  setLogEvents: (v: boolean) => void;
  addReputation: boolean;
  setAddReputation: (v: boolean) => void;
  enableAlert: boolean;
  setEnableAlert: (v: boolean) => void;
}

export function RateLimitAdvancedSection({
  logEvents,
  setLogEvents,
  addReputation,
  setAddReputation,
  enableAlert,
  setEnableAlert,
}: RateLimitAdvancedProps) {
  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div className="text-sm font-semibold text-white">
        4. Advanced Options
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Log rate limit events */}
        <label className="flex items-start gap-2.5 p-3 bg-[#080E18] border border-[#152030] cursor-pointer hover:border-[#1C293D] transition-colors">
          <input
            type="checkbox"
            checked={logEvents}
            onChange={(e) => setLogEvents(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-[#0E1726] border border-[#1C293D] text-blue-600 focus:ring-0 cursor-pointer"
          />
          <div>
            <div className="text-white font-medium text-xs">Log rate limit events</div>
            <div className="text-slate-400 text-[11px] font-sans mt-0.5">
              Record blocked requests in security logs.
            </div>
          </div>
        </label>

        {/* Add to IP reputation list */}
        <label className="flex items-start gap-2.5 p-3 bg-[#080E18] border border-[#152030] cursor-pointer hover:border-[#1C293D] transition-colors">
          <input
            type="checkbox"
            checked={addReputation}
            onChange={(e) => setAddReputation(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-[#0E1726] border border-[#1C293D] text-blue-600 focus:ring-0 cursor-pointer"
          />
          <div>
            <div className="text-white font-medium text-xs">Add to IP reputation list</div>
            <div className="text-slate-400 text-[11px] font-sans mt-0.5">
              Increase risk score for repeated violations.
            </div>
          </div>
        </label>

        {/* Enable alert */}
        <label className="flex items-start gap-2.5 p-3 bg-[#080E18] border border-[#152030] cursor-pointer hover:border-[#1C293D] transition-colors">
          <input
            type="checkbox"
            checked={enableAlert}
            onChange={(e) => setEnableAlert(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-[#0E1726] border border-[#1C293D] text-blue-600 focus:ring-0 cursor-pointer"
          />
          <div>
            <div className="text-white font-medium text-xs">Enable alert</div>
            <div className="text-slate-400 text-[11px] font-sans mt-0.5">
              Send notification when threshold is reached.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
