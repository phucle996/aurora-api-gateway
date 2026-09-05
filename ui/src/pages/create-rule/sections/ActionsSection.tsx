import React from 'react';
import { ShieldAlert, CheckSquare, Square } from 'lucide-react';

interface ActionsProps {
  actionType: string;
  setActionType: (v: string) => void;
  responseCode: string;
  setResponseCode: (v: string) => void;
  customResponse: string;
  setCustomResponse: (v: string) => void;
  logEvent: boolean;
  setLogEvent: (v: boolean) => void;
  addToReputation: boolean;
  setAddToReputation: (v: boolean) => void;
}

export function ActionsSection({
  actionType,
  setActionType,
  responseCode,
  setResponseCode,
  customResponse,
  setCustomResponse,
  logEvent,
  setLogEvent,
  addToReputation,
  setAddToReputation,
}: ActionsProps) {
  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-4 font-mono text-xs">
      <div>
        <div className="text-sm font-semibold text-white">
          3. Actions
        </div>
        <p className="text-slate-400 text-[11px] mt-0.5 font-sans">
          When the conditions are met:
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Action Type */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Action Type
          </label>
          <select
            aria-label="Action type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="Block Request">🚫 Block Request</option>
            <option value="Allow Request">✔ Allow Request</option>
            <option value="Challenge (Captcha)" disabled>Challenge — not available</option>
            <option value="Log Only / Monitor">📝 Log Only / Monitor</option>
          </select>
        </div>

        {/* Response Code */}
        <div>
          <label className="block text-slate-400 mb-1 text-[11px]">
            Response Code
          </label>
          <select
            value={responseCode}
            aria-label="Response code"
            disabled={actionType !== 'Block Request'}
            onChange={(e) => setResponseCode(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="403 Forbidden">403 Forbidden</option>
            <option value="400 Bad Request">400 Bad Request</option>
            <option value="429 Too Many Requests">429 Too Many Requests</option>
            <option value="500 Internal Error">500 Internal Error</option>
          </select>
        </div>

        {/* Custom Response */}
        <div>
          <div className="flex items-center justify-between text-slate-400 mb-1 text-[11px]">
            <span>Custom Response (optional)</span>
            <span className="text-slate-500 text-[10px]">{customResponse.length}/512</span>
          </div>
          <input
            type="text"
            aria-label="Custom response"
            disabled={actionType !== 'Block Request'}
            value={customResponse}
            maxLength={512}
            onChange={(e) => setCustomResponse(e.target.value)}
            placeholder="Request blocked by security policy."
            className="w-full bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Checkboxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-[#152030]/60">
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={logEvent}
            aria-label="Log this event"
            onChange={(e) => setLogEvent(e.target.checked)}
            className="mt-0.5 accent-emerald-500"
          />
          <div>
            <div className="text-slate-200 font-semibold">Log this event</div>
            <div className="text-[11px] text-slate-400 font-sans">
              Record the matched request in security events.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={addToReputation}
            aria-label="Add to IP reputation"
            onChange={(e) => setAddToReputation(e.target.checked)}
            className="mt-0.5 accent-emerald-500"
          />
          <div>
            <div className="text-slate-200 font-semibold">Add to IP reputation (optional)</div>
            <div className="text-[11px] text-slate-400 font-sans">
              Increase risk score for the source IP.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
