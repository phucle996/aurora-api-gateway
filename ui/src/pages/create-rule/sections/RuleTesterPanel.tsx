import React, { useState } from 'react';
import { Play, ShieldAlert, CheckCircle2, Copy, Check } from 'lucide-react';
import type { Condition } from './MatchConditionsSection';

interface RuleTesterProps {
  conditions: Condition[];
}

export function RuleTesterPanel({ conditions }: RuleTesterProps) {
  const [activeTab, setActiveTab] = useState<'Request' | 'cURL'>('Request');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://example.com/search?q=1+or+1=1');
  const [tested, setTested] = useState(true);
  const [matched, setMatched] = useState(true);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const handleCopyCurl = () => {
    const curlCommand = `curl -i -X ${method} "${url}"`;
    navigator.clipboard.writeText(curlCommand);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const handleTest = () => {
    // Check if url matches pattern in conditions
    const patternStr = conditions[0]?.value || '';
    try {
      // Simple regex check simulation
      const cleanPattern = patternStr.replace('(?i)', '');
      const regex = new RegExp(cleanPattern, 'i');
      const isMatch = regex.test(url);
      setMatched(isMatch);
    } catch {
      setMatched(url.includes('or+1=1') || url.includes('select') || url.includes('union'));
    }
    setTested(true);
  };

  return (
    <div className="bg-card border border-border p-4 flex flex-col font-mono text-xs text-foreground">
      <div className="pb-2 border-b border-border">
        <div className="text-sm font-semibold text-foreground">Test Rule</div>
        <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
          Test your rule against a sample request.
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-muted/40 mt-3">
        {(['Request', 'cURL'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 transition-colors cursor-pointer text-xs ${
              activeTab === tab
                ? 'text-primary border-b-2 border-primary font-semibold bg-card'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
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
              className="bg-background border border-input px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
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
              className="flex-1 bg-background border border-input px-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono text-xs"
            />

            <button
              type="button"
              onClick={handleTest}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white font-semibold transition-colors cursor-pointer shadow-xs"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Test</span>
            </button>
          </div>

          {/* Test Result Box */}
          {tested && (
            <div
              className={`p-3 border flex items-start justify-between gap-3 rounded-xs ${
                matched
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {matched ? (
                  <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold text-foreground">
                    {matched ? 'Request would be blocked' : 'Request would be allowed'}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
                    {matched
                      ? 'Matched condition: Request URI contains pattern'
                      : 'No blocking conditions were triggered'}
                  </div>
                </div>
              </div>

              {matched && (
                <span className="inline-flex items-center px-2 py-0.5 bg-rose-500/20 border border-rose-500/40 text-rose-600 dark:text-rose-400 text-[10px] shrink-0 font-bold">
                  403 Forbidden
                </span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 bg-muted/60 border border-border text-[11px] text-foreground mt-3 font-mono flex items-center justify-between gap-3">
          <pre className="whitespace-pre-wrap select-all break-all flex-1">{`curl -i -X ${method} "${url}"`}</pre>
          <button
            type="button"
            onClick={handleCopyCurl}
            className="px-2 py-1 bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border rounded-xs transition-colors shrink-0 cursor-pointer flex items-center gap-1.5 text-[11px] font-sans"
            title={copiedCurl ? "Copied!" : "Copy command"}
            aria-label="Copy cURL command"
          >
            {copiedCurl ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
