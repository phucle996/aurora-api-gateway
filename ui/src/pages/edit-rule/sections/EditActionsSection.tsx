import React from 'react';
import { Check } from 'lucide-react';

interface EditActionsProps {
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

export function EditActionsSection({
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
}: EditActionsProps) {
  return (
    <div className="bg-card border border-border p-4 space-y-4 font-sans text-xs">
      <div>
        <div className="text-sm font-semibold text-foreground">
          3. Actions
        </div>
        <p className="text-muted-foreground text-[11px] mt-0.5 font-sans">
          When the conditions are met:
        </p>
      </div>

      {/* Row 1: Action Type & Response Code */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Action Type */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">
            Action Type
          </label>
          <select
            aria-label="Action type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="Block Request">Block Request</option>
            <option value="Allow Request">Allow Request</option>
            <option value="Log Only / Monitor">Log Only / Monitor</option>
          </select>
        </div>

        {/* Response Code */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px]">
            Response Code
          </label>
          <select
            value={responseCode}
            aria-label="Response code"
            disabled={actionType !== 'Block Request'}
            onChange={(e) => setResponseCode(e.target.value)}
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="400">400 Bad Request</option>
            <option value="403">403 Forbidden</option>
            <option value="429">429 Too Many Requests</option>
            <option value="500">500 Internal Server Error</option>
          </select>
        </div>
      </div>

      {/* Row 2: Custom Response (Textarea) */}
      <div>
        <div className="flex items-center justify-between text-muted-foreground mb-1 text-[11px]">
          <span>Custom Response (optional)</span>
          <span className="text-muted-foreground text-[10px]">{customResponse.length}/512</span>
        </div>
        <textarea
          rows={3}
          aria-label="Custom response"
          disabled={actionType !== 'Block Request'}
          value={customResponse}
          maxLength={512}
          onChange={(e) => setCustomResponse(e.target.value)}
          placeholder="Request blocked by security policy."
          className="w-full bg-background border border-input p-2.5 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary resize-none font-mono text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        />
      </div>

      {/* Row 3: Checkboxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border">
        <label className="flex items-start gap-2.5 cursor-pointer select-none group">
          <div className="relative flex items-center justify-center shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={logEvent}
              aria-label="Log this event"
              onChange={(e) => setLogEvent(e.target.checked)}
              className="peer sr-only"
            />
            <div
              className={`w-4 h-4 rounded-xs border transition-colors flex items-center justify-center ${logEvent
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-background border-input text-transparent group-hover:border-primary/50'
                }`}
            >
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
          </div>
          <div>
            <div className="text-foreground font-semibold">Log this event</div>
            <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
              Record the matched request in security events.
            </div>
          </div>
        </label>

        <label className="flex items-start gap-2.5 cursor-pointer select-none group">
          <div className="relative flex items-center justify-center shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={addToReputation}
              aria-label="Add to IP reputation"
              onChange={(e) => setAddToReputation(e.target.checked)}
              className="peer sr-only"
            />
            <div
              className={`w-4 h-4 rounded-xs border transition-colors flex items-center justify-center ${addToReputation
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-background border-input text-transparent group-hover:border-primary/50'
                }`}
            >
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
          </div>
          <div>
            <div className="text-foreground font-semibold">Add to IP reputation (optional)</div>
            <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
              Increase risk score for the source IP.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
