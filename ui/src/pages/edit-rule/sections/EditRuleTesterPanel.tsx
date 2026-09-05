import React, { useState } from 'react';
import { Send, ShieldAlert, CheckCircle2, ChevronRight, ChevronDown } from 'lucide-react';
import type { Condition } from '../../create-rule/sections/MatchConditionsSection';

interface EditRuleTesterProps {
  conditions: Condition[];
}

export function EditRuleTesterPanel({ conditions }: EditRuleTesterProps) {
  const [activeTab, setActiveTab] = useState<'Request' | 'cURL'>('Request');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://example.com/search?q=1+or+1=1');
  const [tested, setTested] = useState(true);
  const [matched, setMatched] = useState(true);
  const [showDetails, setShowDetails] = useState(false);

  const handleSend = () => {
    const patternStr = conditions[0]?.value || '';
    try {
      const cleanPattern = patternStr.replace('(?i)', '');
      const regex = new RegExp(cleanPattern, 'i');
      setMatched(regex.test(url));
    } catch {
      setMatched(url.includes('or+1=1') || url.includes('select') || url.includes('union'));
    }
    setTested(true);
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col font-mono text-xs">
      <div className="pb-2 border-b border-[#152030]">
        <div className="text-sm font-semibold text-white">Test Rule</div>
        <div className="text-[11px] text-slate-400 font-sans mt-0.5">
          Test your rule against a sample request.
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#152030] bg-[#080E18] mt-3">
        {(['Request', 'cURL'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 transition-colors cursor-pointer ${
              activeTab === tab
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#0E1726]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Test Form */}
      {activeTab === 'Request' ? (
        <div className="space-y-3 mt-3">
          <div className="flex items-center gap-2">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="bg-[#0E1726] border border-[#1C293D] px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-emerald-500 cursor-pointer"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>

            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/search?q=1+or+1=1"
              className="flex-1 bg-[#0E1726] border border-[#1C293D] px-3 py-1.5 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 font-mono text-xs"
            />

            <button
              type="button"
              onClick={handleSend}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white font-semibold transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </div>

          {/* Test Result Box */}
          {tested && (
            <div
              className={`p-3 border space-y-2 ${
                matched
                  ? 'bg-rose-950/30 border-rose-500/40 text-rose-400'
                  : 'bg-emerald-950/30 border-emerald-500/40 text-emerald-400'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  {matched ? (
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-bold text-white">
                      {matched ? 'Request would be blocked' : 'Request would be allowed'}
                    </div>
                    <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                      {matched
                        ? 'Matched condition: Request URI contains pattern'
                        : 'No blocking conditions triggered'}
                    </div>
                  </div>
                </div>

                {matched && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-rose-950/60 border border-rose-500/50 text-rose-400 text-[10px] shrink-0 font-bold">
                    403 Forbidden
                  </span>
                )}
              </div>

              {/* View Details Toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer pt-1"
                >
                  {showDetails ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>View Details</span>
                </button>

                {showDetails && (
                  <div className="p-2.5 bg-[#080E18] border border-[#1C293D] mt-2 space-y-1 text-[11px] text-slate-300">
                    <div>
                      <span className="text-slate-500">Evaluation latency:</span> 0.14ms
                    </div>
                    <div>
                      <span className="text-slate-500">Matched regex:</span>{' '}
                      <code>(?i)(union|select|insert|drop|or\s+1=1)</code>
                    </div>
                    <div>
                      <span className="text-slate-500">Action dispatched:</span> HTTP 403 response
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 bg-[#04070D] border border-[#1C293D] text-[11px] text-slate-300 mt-3 font-mono">
          <pre className="whitespace-pre-wrap">{`curl -i -X ${method} "${url}"`}</pre>
        </div>
      )}
    </div>
  );
}
