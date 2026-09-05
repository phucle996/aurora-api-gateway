import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  ShieldAlert,
  Sliders,
  Play,
  CheckCircle2,
  FileCode,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import type { RuleItem } from './RulesTable';

interface PreviewRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  rule: RuleItem;
}

export function PreviewRuleModal({
  isOpen,
  onClose,
  rule,
}: PreviewRuleModalProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<
    'Rule Logic' | 'Test Request' | 'Match Result' | 'Generated Config'
  >('Rule Logic');

  // Test Runner State
  const [testMethod, setTestMethod] = useState('GET');
  const [testUrl, setTestUrl] = useState('https://example.com/search?q=1+or+1=1');
  const [testHeaders, setTestHeaders] = useState('User-Agent: Mozilla/5.0\nAccept: application/json');
  const [testBody, setTestBody] = useState('');
  const [hasTested, setHasTested] = useState(true);
  const [isBlocked, setIsBlocked] = useState(true);
  const [showMatchDetails, setShowMatchDetails] = useState(true);
  const [copied, setCopied] = useState(false);
  const [configSubTab, setConfigSubTab] = useState<'nginx' | 'lua' | 'json'>('nginx');

  if (!isOpen) return null;

  const ruleSlug = rule.name.toLowerCase().replace(/\s+/g, '-');

  const nginxCode = `# Rule: ${ruleSlug}
location / {
    if ($request_uri ~* "(union|select|insert|drop|or\\s+1=1)") {
        return 403;
    }
    if ($arg_* ~* "(union|select|insert|drop|--|;|\\s+1=1)") {
        return 403;
    }
    if ($request_body ~* "(union|select|insert|drop|--|;|\\s+1=1)") {
        return 403;
    }
}`;

  const luaCode = `-- OpenResty / Lua evaluation for ${ruleSlug}
local uri = ngx.var.request_uri or ""
local args = ngx.var.args or ""
local pattern = "(?i)(union|select|insert|drop|or\\\\s+1=1)"

if ngx.re.find(uri, pattern, "jo") or ngx.re.find(args, pattern, "jo") then
    ngx.status = 403
    ngx.header.content_type = "application/json"
    ngx.say('{"error":"forbidden","message":"Request blocked by security policy."}')
    return ngx.exit(403)
end`;

  const jsonCode = JSON.stringify(
    {
      id: rule.id,
      name: ruleSlug,
      description: rule.description,
      action: 'BLOCK',
      priority: 100,
      enabled: true,
      conditions: [
        {
          field: 'Request URI',
          operator: 'CONTAINS_PATTERN',
          value: '(?i)(union|select|insert|drop|or\\s+1=1)',
        },
        {
          field: 'Query Parameter',
          operator: 'CONTAINS_PATTERN',
          value: '(?i)(union|select|insert|drop|--|;|\\s+1=1)',
        },
        {
          field: 'Request Body',
          operator: 'CONTAINS_PATTERN',
          value: '(?i)(union|select|insert|drop|--|;|\\s+1=1)',
        },
      ],
      response: {
        code: 403,
        message: 'Request blocked by security policy.',
      },
    },
    null,
    2
  );

  const currentConfigContent =
    configSubTab === 'nginx' ? nginxCode : configSubTab === 'lua' ? luaCode : jsonCode;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentConfigContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRunTest = (customUrl?: string) => {
    const targetUrl = customUrl || testUrl;
    const isMalicious =
      targetUrl.includes('or+1=1') ||
      targetUrl.includes('or 1=1') ||
      targetUrl.includes('union') ||
      targetUrl.includes('select') ||
      targetUrl.includes('script') ||
      targetUrl.includes('..') ||
      testBody.includes('union') ||
      testBody.includes('select');

    setIsBlocked(isMalicious);
    setHasTested(true);
    setActiveTab('Match Result');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto no-scrollbar">
      <div className="w-full max-w-4xl bg-[#0B1320] border border-[#1C293D] shadow-2xl flex flex-col my-auto select-none overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#152030] flex items-start justify-between bg-[#080E18]">
          <div>
            <h2 className="text-sm font-semibold text-white font-mono tracking-wide">
              Preview Rule
            </h2>
            <p className="text-[11px] text-slate-400 font-sans mt-0.5">
              See how this rule will be applied and test it with sample requests.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white hover:bg-[#152030] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Metadata Banner */}
        <div className="px-5 py-3 bg-[#060A10] border-b border-[#152030] flex flex-wrap items-center justify-between gap-4 font-mono text-xs">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-rose-950/40 border border-rose-500/40 text-rose-400 shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white truncate">
                  {ruleSlug}
                </span>
                <span className="inline-flex items-center px-1.5 py-0.2 bg-emerald-950/60 border border-emerald-500/50 text-emerald-400 text-[10px]">
                  Enabled
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-sans truncate mt-0.5 max-w-md">
                {rule.description}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-5 text-[11px]">
            <div>
              <span className="text-slate-500 block text-[9px] uppercase">Policy</span>
              <span className="text-slate-200 font-semibold">{rule.scope || 'Global Web Policy'}</span>
            </div>

            <div>
              <span className="text-slate-500 block text-[9px] uppercase">Priority</span>
              <span className="text-slate-200 font-semibold">100</span>
            </div>

            <div>
              <span className="text-slate-500 block text-[9px] uppercase">Tags</span>
              <div className="flex items-center gap-1 mt-0.5">
                <span className="px-1.5 py-0.2 bg-rose-950/60 border border-rose-500/40 text-rose-400 text-[9px]">
                  sql-injection
                </span>
                <span className="px-1.5 py-0.2 bg-amber-950/60 border border-amber-500/40 text-amber-400 text-[9px]">
                  web
                </span>
                <span className="px-1.5 py-0.2 bg-rose-950/60 border border-rose-500/40 text-rose-400 text-[9px]">
                  critical
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Bar */}
        <div className="flex border-b border-[#152030] bg-[#070B12] text-xs font-mono">
          {[
            { id: 'Rule Logic', icon: Sliders },
            { id: 'Test Request', icon: Play },
            { id: 'Match Result', icon: CheckCircle2 },
            { id: 'Generated Config', icon: FileCode },
          ].map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id as any)}
                className={`flex items-center gap-2 px-4 py-2.5 transition-colors cursor-pointer text-xs ${
                  active
                    ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#0E1726]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.id}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body: Tabbed Views (Smooth scroll without visible scrollbars) */}
        <div className="p-5 max-h-[480px] overflow-y-auto no-scrollbar font-mono text-xs">
          {/* TAB 1: RULE LOGIC */}
          {activeTab === 'Rule Logic' && (
            <div className="space-y-4">
              {/* Conditions Card */}
              <div className="bg-[#080E18] border border-[#152030] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-white text-xs">Rule Conditions</div>
                  <span className="text-[10px] text-slate-500">Evaluated with OR semantics</span>
                </div>

                {/* Condition 1 */}
                <div className="p-3 bg-[#0B1320] border border-[#152030] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white font-bold">1. Request URI</span>
                    <span className="text-[10px] text-cyan-400 bg-blue-950/60 border border-blue-800/40 px-1.5 py-0.2">
                      Contains (Pattern)
                    </span>
                  </div>
                  <div className="p-2 bg-[#04070D] border border-[#1C293D] text-xs text-rose-300 font-mono select-text">
                    (?i)(union|select|insert|drop|or\s+1=1)
                  </div>
                </div>

                {/* Connector */}
                <div className="flex justify-center">
                  <span className="px-2.5 py-0.5 bg-[#0E1726] border border-[#1C293D] text-slate-400 text-[10px] font-bold">
                    OR
                  </span>
                </div>

                {/* Condition 2 */}
                <div className="p-3 bg-[#0B1320] border border-[#152030] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white font-bold">2. Query Parameter</span>
                    <span className="text-[10px] text-cyan-400 bg-blue-950/60 border border-blue-800/40 px-1.5 py-0.2">
                      Contains (Pattern)
                    </span>
                  </div>
                  <div className="p-2 bg-[#04070D] border border-[#1C293D] text-xs text-rose-300 font-mono select-text">
                    (?i)(union|select|insert|drop|--|;|\s+1=1)
                  </div>
                </div>

                {/* Connector */}
                <div className="flex justify-center">
                  <span className="px-2.5 py-0.5 bg-[#0E1726] border border-[#1C293D] text-slate-400 text-[10px] font-bold">
                    OR
                  </span>
                </div>

                {/* Condition 3 */}
                <div className="p-3 bg-[#0B1320] border border-[#152030] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white font-bold">3. Request Body</span>
                    <span className="text-[10px] text-cyan-400 bg-blue-950/60 border border-blue-800/40 px-1.5 py-0.2">
                      Contains (Pattern)
                    </span>
                  </div>
                  <div className="p-2 bg-[#04070D] border border-[#1C293D] text-xs text-rose-300 font-mono select-text">
                    (?i)(union|select|insert|drop|--|;|\s+1=1)
                  </div>
                </div>
              </div>

              {/* Action Card */}
              <div className="bg-[#080E18] border border-[#152030] p-4 space-y-3">
                <div className="font-semibold text-white text-xs">Action & Execution</div>

                <div className="p-2.5 bg-[#0B1320] border border-[#152030] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-rose-400">
                    <span className="text-sm">🚫</span>
                    <span className="font-bold text-xs">Block Request</span>
                  </div>
                  <span className="px-2 py-0.5 bg-rose-950/60 border border-rose-500/50 text-rose-300 text-[11px] font-mono">
                    HTTP 403
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <span className="text-slate-500 block text-[10px] mb-1">Response Code</span>
                    <div className="p-2 bg-[#0B1320] border border-[#152030] text-slate-200 text-xs">
                      403 Forbidden
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500 block text-[10px] mb-1">Custom Response</span>
                    <div className="p-2 bg-[#0B1320] border border-[#152030] text-slate-300 text-xs truncate">
                      Request blocked by security policy.
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[#152030] text-xs">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Scope</span>
                    <span className="text-slate-300">All Sources / All Paths</span>
                  </div>

                  <div>
                    <span className="text-slate-500 block text-[10px]">Log Event</span>
                    <span className="text-cyan-400 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-cyan-400 inline-block" /> Enabled
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 block text-[10px]">Add to Reputation</span>
                    <span className="text-slate-500 font-semibold">Disabled</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TEST REQUEST */}
          {activeTab === 'Test Request' && (
            <div className="space-y-4">
              <div className="bg-[#080E18] border border-[#152030] p-4 space-y-4">
                <div>
                  <div className="font-semibold text-white text-xs">Test Request Simulator</div>
                  <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                    Configure sample HTTP parameters and execute against Aurora WAF engine.
                  </div>
                </div>

                {/* Quick Presets */}
                <div>
                  <span className="text-[10px] text-slate-500 block mb-1.5">Quick Payload Presets:</span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTestUrl('https://example.com/search?q=1+or+1=1');
                        setTestMethod('GET');
                      }}
                      className="px-2.5 py-1 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-rose-300 hover:text-rose-200 text-xs cursor-pointer transition-colors"
                    >
                      SQLi: `?q=1+or+1=1`
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTestUrl('https://example.com/products?cat=union+select+null,password+from+users');
                        setTestMethod('GET');
                      }}
                      className="px-2.5 py-1 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-rose-300 hover:text-rose-200 text-xs cursor-pointer transition-colors"
                    >
                      UNION Injection
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTestUrl('https://example.com/search?q=laptop');
                        setTestMethod('GET');
                      }}
                      className="px-2.5 py-1 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-emerald-400 hover:text-emerald-300 text-xs cursor-pointer transition-colors"
                    >
                      Benign Request (`?q=laptop`)
                    </button>
                  </div>
                </div>

                {/* Request Line */}
                <div className="space-y-1">
                  <label className="block text-slate-400 text-[11px]">Request URL</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={testMethod}
                      onChange={(e) => setTestMethod(e.target.value)}
                      className="bg-[#0E1726] border border-[#1C293D] px-3 py-2 text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer text-xs"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                    </select>

                    <input
                      type="text"
                      value={testUrl}
                      onChange={(e) => setTestUrl(e.target.value)}
                      placeholder="https://example.com/search?q=1+or+1=1"
                      className="flex-1 bg-[#0E1726] border border-[#1C293D] px-3 py-2 text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Headers & Body */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">Request Headers</label>
                    <textarea
                      value={testHeaders}
                      onChange={(e) => setTestHeaders(e.target.value)}
                      rows={3}
                      className="w-full bg-[#0E1726] border border-[#1C293D] p-2 text-slate-300 text-xs font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">Request Body (Optional)</label>
                    <textarea
                      value={testBody}
                      onChange={(e) => setTestBody(e.target.value)}
                      placeholder='{"query": "SELECT * FROM users"}'
                      rows={3}
                      className="w-full bg-[#0E1726] border border-[#1C293D] p-2 text-slate-300 text-xs font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>

                {/* Run Button */}
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleRunTest()}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs cursor-pointer transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Run Evaluation Test</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MATCH RESULT */}
          {activeTab === 'Match Result' && (
            <div className="space-y-4">
              {hasTested ? (
                <div className="space-y-4">
                  {/* Status Banner */}
                  <div
                    className={`p-4 border ${
                      isBlocked
                        ? 'bg-rose-950/30 border-rose-500/40 text-rose-400'
                        : 'bg-emerald-950/30 border-emerald-500/40 text-emerald-400'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-1.5 border ${
                            isBlocked
                              ? 'bg-rose-950/80 border-rose-500/50 text-rose-400'
                              : 'bg-emerald-950/80 border-emerald-500/50 text-emerald-400'
                          }`}
                        >
                          {isBlocked ? (
                            <AlertTriangle className="w-4 h-4" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white">
                            {isBlocked ? 'Request would be blocked' : 'Request would be allowed'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                            {isBlocked
                              ? 'Matched condition: Request URI contains SQL injection pattern'
                              : 'No matching blocking conditions were triggered. Request passes downstream.'}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center px-2.5 py-1 text-xs font-bold shrink-0 ${
                          isBlocked
                            ? 'bg-rose-950/80 border border-rose-500/50 text-rose-300'
                            : 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-300'
                        }`}
                      >
                        {isBlocked ? '403 Forbidden' : '200 OK Pass'}
                      </span>
                    </div>

                    {/* Match Details Section */}
                    {isBlocked && (
                      <div className="pt-3 mt-3 border-t border-rose-500/20 text-xs">
                        <button
                          type="button"
                          onClick={() => setShowMatchDetails(!showMatchDetails)}
                          className="flex items-center gap-1.5 text-slate-300 hover:text-white cursor-pointer font-bold"
                        >
                          {showMatchDetails ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          <span>Match Details Breakdown</span>
                        </button>

                        {showMatchDetails && (
                          <div className="space-y-2 mt-2.5 p-3 bg-[#04070D] border border-[#1C293D] font-mono text-[11px] text-slate-300">
                            <div className="flex justify-between items-center py-1 border-b border-[#152030]">
                              <span className="text-slate-500">Matched Field:</span>
                              <span className="px-2 py-0.5 bg-blue-950 border border-blue-500/40 text-cyan-400 font-bold">
                                Request URI
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-[#152030]">
                              <span className="text-slate-500">Matched Pattern:</span>
                              <span className="text-rose-300">
                                (?i)(union|select|insert|drop|or\s+1=1)
                              </span>
                            </div>
                            <div className="flex justify-between items-center py-1 border-b border-[#152030]">
                              <span className="text-slate-500">Matched Value:</span>
                              <span>
                                /search?q=<span className="text-rose-400 bg-rose-950 px-1 font-bold">1+or+1=1</span>
                              </span>
                            </div>
                            <div className="flex justify-between items-start py-1">
                              <span className="text-slate-500">Explanation:</span>
                              <span className="text-slate-200 text-right max-w-sm">
                                The request URI contains an inline boolean-based SQL injection pattern (1=1).
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Engine Performance Diagnostics */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-[#080E18] border border-[#152030]">
                      <div className="text-[10px] text-slate-500 flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-400" />
                        <span>Evaluation Latency</span>
                      </div>
                      <div className="text-sm font-bold text-white mt-1">0.14 ms</div>
                    </div>

                    <div className="p-3 bg-[#080E18] border border-[#152030]">
                      <div className="text-[10px] text-slate-500">Regex Engine</div>
                      <div className="text-sm font-bold text-cyan-400 mt-1">Rust + Hyperscan</div>
                    </div>

                    <div className="p-3 bg-[#080E18] border border-[#152030]">
                      <div className="text-[10px] text-slate-500">Action Decision</div>
                      <div className="text-sm font-bold text-rose-400 mt-1">
                        {isBlocked ? 'TERMINATE (403)' : 'FORWARD (PASS)'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center bg-[#080E18] border border-[#152030] text-slate-400">
                  <Play className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                  <p>No test has been executed yet.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('Test Request')}
                    className="mt-3 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                  >
                    Go to Test Request
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: GENERATED CONFIG */}
          {activeTab === 'Generated Config' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-[#152030] bg-[#080E18]">
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => setConfigSubTab('nginx')}
                    className={`px-3.5 py-2 text-xs transition-colors cursor-pointer ${
                      configSubTab === 'nginx'
                        ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    NGINX Config
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigSubTab('lua')}
                    className={`px-3.5 py-2 text-xs transition-colors cursor-pointer ${
                      configSubTab === 'lua'
                        ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    OpenResty / Lua
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigSubTab('json')}
                    className={`px-3.5 py-2 text-xs transition-colors cursor-pointer ${
                      configSubTab === 'json'
                        ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    JSON Spec
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1 bg-[#152030] hover:bg-[#1C293D] border border-[#1C293D] text-slate-300 hover:text-white transition-colors cursor-pointer text-[11px] m-1"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code block with line numbers */}
              <div className="p-3 bg-[#04070D] border border-[#1C293D] overflow-x-auto text-[11px] leading-relaxed text-slate-300 no-scrollbar">
                {currentConfigContent.split('\n').map((line, idx) => (
                  <div key={idx} className="flex">
                    <span className="w-6 text-slate-600 select-none text-right pr-3 shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-rose-300 font-mono select-text whitespace-pre">
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 bg-[#080E18] border-t border-[#152030] flex items-center justify-between font-mono text-xs">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            Close
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(`/rules/${rule.id}/edit`);
            }}
            className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white font-bold transition-colors cursor-pointer shadow-sm"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit Rule</span>
          </button>
        </div>
      </div>
    </div>
  );
}
