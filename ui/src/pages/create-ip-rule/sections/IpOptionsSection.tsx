import React from 'react';

interface IpOptionsProps {
  logEvent: boolean;
  setLogEvent: (v: boolean) => void;
  addReputation: boolean;
  setAddReputation: (v: boolean) => void;
  enableAlert: boolean;
  setEnableAlert: (v: boolean) => void;
}

export function IpOptionsSection({
  logEvent,
  setLogEvent,
  addReputation,
  setAddReputation,
  enableAlert,
  setEnableAlert,
}: IpOptionsProps) {
  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div className="text-sm font-semibold text-white">
        4. Additional Options
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Log matching requests */}
        <label className="flex items-start gap-2.5 p-3 bg-[#080E18] border border-[#152030] cursor-pointer hover:border-[#1C293D] transition-colors">
          <input
            type="checkbox"
            checked={logEvent}
            onChange={(e) => setLogEvent(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-[#0E1726] border border-[#1C293D] text-blue-600 focus:ring-0 cursor-pointer"
          />
          <div>
            <div className="text-white font-medium text-xs">Log matching requests</div>
            <div className="text-slate-400 text-[11px] font-sans mt-0.5">
              Record this event in security logs.
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
              Increase risk score for matched IPs.
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
              Send notification when triggered.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
