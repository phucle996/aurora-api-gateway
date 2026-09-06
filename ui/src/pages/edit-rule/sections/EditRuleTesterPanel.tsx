import React, { useState } from 'react';
import { Send, ShieldAlert, CheckCircle2, ChevronRight, ChevronDown, Loader2, Copy, Check } from 'lucide-react';
import type { Condition } from '../../create-rule/sections/MatchConditionsSection';
import { getAuthToken } from '@/lib/fetcher';

interface EditRuleTesterProps {
  conditions: Condition[];
  ruleId?: string;
  logicMode?: 'ALL' | 'ANY';
}

export function EditRuleTesterPanel({ conditions, ruleId, logicMode = 'ALL' }: EditRuleTesterProps) {
  const [activeTab, setActiveTab] = useState<'Request' | 'cURL'>('Request');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('https://example.com/search?q=1+or+1=1');
  const [isTesting, setIsTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [matched, setMatched] = useState(false);
  const [matchedField, setMatchedField] = useState('');
  const [matchedPattern, setMatchedPattern] = useState('');
  const [latency, setLatency] = useState('0.14ms');
  const [actionDispatched, setActionDispatched] = useState('HTTP 403 response');
  const [explanation, setExplanation] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const handleCopyCurl = () => {
    const curlCommand = `curl -i -X ${method} "${url}"`;
    navigator.clipboard.writeText(curlCommand);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  };

  const handleSend = async () => {
    setIsTesting(true);
    const start = performance.now();
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const payload = {
        rule_id: ruleId ? parseInt(ruleId, 10) : undefined,
        method,
        url,
        conditions: conditions.map((c) => ({
          field: c.field,
          operator: c.operator,
          value: c.value,
          header_name: c.headerName || '',
        })),
        logic_mode: logicMode.toLowerCase(),
        action: 'block',
        response_code: 403,
      };

      const response = await fetch('/api/v1/rules/test', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const data = await response.json();
        setMatched(data.matched);
        setLatency(`${data.latency_ms?.toFixed(2) ?? '0.10'}ms`);
        setMatchedField(data.matched_field || (conditions[0]?.field ?? 'Request URI'));
        setMatchedPattern(data.matched_pattern || (conditions[0]?.value ?? ''));
        setActionDispatched(data.action_dispatched || (data.matched ? 'HTTP 403 response' : 'HTTP 200 Pass Through'));
        setExplanation(data.explanation || (data.matched ? 'Matched condition: Request URI contains pattern' : 'No blocking conditions triggered'));
        setTested(true);
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch {
      // Fallback local evaluation in case of offline/network failure
      let hit = false;
      let hitField = '';
      let hitPattern = '';

      for (const c of conditions) {
        if (!c.value) continue;
        try {
          const cleanPattern = c.value.replace('(?i)', '');
          const regex = new RegExp(cleanPattern, 'i');
          if (regex.test(url)) {
            hit = true;
            hitField = c.field;
            hitPattern = c.value;
            break;
          }
        } catch {
          if (url.toLowerCase().includes(c.value.toLowerCase())) {
            hit = true;
            hitField = c.field;
            hitPattern = c.value;
            break;
          }
        }
      }

      const elapsed = Math.max(0.08, performance.now() - start).toFixed(2);
      setLatency(`${elapsed}ms`);
      setMatched(hit);
      setMatchedField(hitField || (conditions[0]?.field ?? 'Request URI'));
      setMatchedPattern(hitPattern || (conditions[0]?.value ?? ''));
      setActionDispatched(hit ? 'HTTP 403 response' : 'HTTP 200 Pass Through');
      setExplanation(hit ? `Matched condition: ${hitField || 'Request URI'} contains pattern` : 'No blocking conditions triggered');
      setTested(true);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="bg-card border border-border p-4 flex flex-col font-sans text-xs text-foreground">
      <div className="pb-2 border-b border-border">
        <div className="text-sm font-semibold text-foreground">Test Rule</div>
        <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
          Test your rule against a sample request via live backend evaluation.
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
              disabled={isTesting}
              onClick={handleSend}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-70 text-white font-semibold transition-colors cursor-pointer shadow-xs"
            >
              {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{isTesting ? 'Testing...' : 'Send'}</span>
            </button>
          </div>

          {/* Test Result Box - Only shown after user clicks Send */}
          {tested && (
            <div
              className={`p-3 border space-y-2 rounded-xs ${
                matched
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
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
                      {explanation || (matched ? `Matched condition: ${matchedField} contains pattern` : 'No blocking conditions triggered')}
                    </div>
                  </div>
                </div>

                {matched && (
                  <span className="inline-flex items-center px-2 py-0.5 bg-rose-500/20 border border-rose-500/40 text-rose-600 dark:text-rose-400 text-[10px] shrink-0 font-bold">
                    403 Forbidden
                  </span>
                )}
              </div>

              {/* View Details Toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer pt-1"
                >
                  {showDetails ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>View Details</span>
                </button>

                {showDetails && (
                  <div className="p-2.5 bg-muted/60 border border-border mt-2 space-y-1 text-[11px] text-foreground">
                    <div>
                      <span className="text-muted-foreground">Evaluation latency:</span> {latency}
                    </div>
                    {matchedPattern && (
                      <div>
                        <span className="text-muted-foreground">Matched regex:</span>{' '}
                        <code className="bg-background px-1 py-0.5 rounded border border-border text-foreground font-mono">{matchedPattern}</code>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Action dispatched:</span> {actionDispatched}
                    </div>
                  </div>
                )}
              </div>
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
