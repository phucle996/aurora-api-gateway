import React from 'react';
import { Check } from 'lucide-react';

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
    <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 space-y-4 font-sans text-xs">
      <div>
        <div className="text-sm font-semibold text-slate-900 dark:text-white">
          3. Actions
        </div>
        <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5 font-sans">
          When the conditions are met:
        </p>
      </div>

      {/* Row 1: Action Type & Response Code */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Action Type */}
        <div>
          <label className="block text-slate-600 dark:text-slate-400 mb-1 text-[11px]">
            Action Type
          </label>
          <select
            aria-label="Action type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-300 dark:border-[#1C293D] px-3 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            <option value="Block Request">Block Request</option>
            <option value="Allow Request">Allow Request</option>
            <option value="Challenge (Captcha)" disabled>Challenge — not available</option>
            <option value="Log Only / Monitor">Log Only / Monitor</option>
          </select>
        </div>

        {/* Response Code */}
        <div>
          <label className="block text-slate-600 dark:text-slate-400 mb-1 text-[11px]">
            Response Code
          </label>
          <select
            value={responseCode}
            aria-label="Response code"
            disabled={actionType !== 'Block Request'}
            onChange={(e) => setResponseCode(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-300 dark:border-[#1C293D] px-3 py-1.5 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <optgroup label="Client Errors (4xx)">
              <option value="400 Bad Request">400 Bad Request</option>
              <option value="401 Unauthorized">401 Unauthorized</option>
              <option value="402 Payment Required">402 Payment Required</option>
              <option value="403 Forbidden">403 Forbidden</option>
              <option value="404 Not Found">404 Not Found</option>
              <option value="405 Method Not Allowed">405 Method Not Allowed</option>
              <option value="406 Not Acceptable">406 Not Acceptable</option>
              <option value="407 Proxy Authentication Required">407 Proxy Authentication Required</option>
              <option value="408 Request Timeout">408 Request Timeout</option>
              <option value="409 Conflict">409 Conflict</option>
              <option value="410 Gone">410 Gone</option>
              <option value="411 Length Required">411 Length Required</option>
              <option value="412 Precondition Failed">412 Precondition Failed</option>
              <option value="413 Payload Too Large">413 Payload Too Large</option>
              <option value="414 URI Too Long">414 URI Too Long</option>
              <option value="415 Unsupported Media Type">415 Unsupported Media Type</option>
              <option value="416 Range Not Satisfiable">416 Range Not Satisfiable</option>
              <option value="417 Expectation Failed">417 Expectation Failed</option>
              <option value="418 I'm a teapot">418 I'm a teapot</option>
              <option value="421 Misdirected Request">421 Misdirected Request</option>
              <option value="422 Unprocessable Entity">422 Unprocessable Entity</option>
              <option value="423 Locked">423 Locked</option>
              <option value="424 Failed Dependency">424 Failed Dependency</option>
              <option value="425 Too Early">425 Too Early</option>
              <option value="426 Upgrade Required">426 Upgrade Required</option>
              <option value="428 Precondition Required">428 Precondition Required</option>
              <option value="429 Too Many Requests">429 Too Many Requests</option>
              <option value="431 Request Header Fields Too Large">431 Request Header Fields Too Large</option>
              <option value="444 Connection Closed Without Response">444 Connection Closed Without Response</option>
              <option value="451 Unavailable For Legal Reasons">451 Unavailable For Legal Reasons</option>
            </optgroup>
            <optgroup label="Server Errors (5xx)">
              <option value="500 Internal Error">500 Internal Error</option>
              <option value="501 Not Implemented">501 Not Implemented</option>
              <option value="502 Bad Gateway">502 Bad Gateway</option>
              <option value="503 Service Unavailable">503 Service Unavailable</option>
              <option value="504 Gateway Timeout">504 Gateway Timeout</option>
              <option value="505 HTTP Version Not Supported">505 HTTP Version Not Supported</option>
              <option value="506 Variant Also Negotiates">506 Variant Also Negotiates</option>
              <option value="507 Insufficient Storage">507 Insufficient Storage</option>
              <option value="508 Loop Detected">508 Loop Detected</option>
              <option value="510 Not Extended">510 Not Extended</option>
              <option value="511 Network Authentication Required">511 Network Authentication Required</option>
            </optgroup>
            <optgroup label="Redirection (3xx)">
              <option value="301 Moved Permanently">301 Moved Permanently</option>
              <option value="302 Found">302 Found</option>
              <option value="303 See Other">303 See Other</option>
              <option value="304 Not Modified">304 Not Modified</option>
              <option value="307 Temporary Redirect">307 Temporary Redirect</option>
              <option value="308 Permanent Redirect">308 Permanent Redirect</option>
            </optgroup>
            <optgroup label="Success (2xx)">
              <option value="200 OK">200 OK</option>
              <option value="201 Created">201 Created</option>
              <option value="202 Accepted">202 Accepted</option>
              <option value="204 No Content">204 No Content</option>
            </optgroup>
          </select>
        </div>
      </div>

      {/* Row 2: Custom Response (Textarea) */}
      <div>
        <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1 text-[11px]">
          <span>Custom Response (optional)</span>
          <span className="text-slate-400 dark:text-slate-500 text-[10px]">{customResponse.length}/512</span>
        </div>
        <textarea
          rows={3}
          aria-label="Custom response"
          disabled={actionType !== 'Block Request'}
          value={customResponse}
          maxLength={512}
          onChange={(e) => setCustomResponse(e.target.value)}
          placeholder="Request blocked by security policy."
          className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-300 dark:border-[#1C293D] p-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-blue-500 resize-none font-mono text-xs disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        />
      </div>

      {/* Row 3: Checkboxes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-[#152030]/60">
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
              className={`w-4 h-4 rounded-xs border transition-colors flex items-center justify-center ${
                logEvent
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-[#0E1726] border-slate-300 dark:border-[#1C293D] text-transparent group-hover:border-slate-400 dark:group-hover:border-slate-500'
              }`}
            >
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
          </div>
          <div>
            <div className="text-slate-900 dark:text-slate-200 font-semibold">Log this event</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
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
              className={`w-4 h-4 rounded-xs border transition-colors flex items-center justify-center ${
                addToReputation
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white dark:bg-[#0E1726] border-slate-300 dark:border-[#1C293D] text-transparent group-hover:border-slate-400 dark:group-hover:border-slate-500'
              }`}
            >
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
          </div>
          <div>
            <div className="text-slate-900 dark:text-slate-200 font-semibold">Add to IP reputation (optional)</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-sans mt-0.5">
              Increase risk score for the source IP.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
