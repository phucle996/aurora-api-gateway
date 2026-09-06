import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { Condition } from '../../create-rule/sections/MatchConditionsSection';

interface EditRulePreviewProps {
  name: string;
  policy: string;
  priority: number;
  conditions: Condition[];
  responseCode: string;
}

export function EditRulePreviewPanel({
  name,
  policy,
  priority,
  conditions,
  responseCode,
}: EditRulePreviewProps) {
  const [tab, setTab] = useState<'NGINX Config' | 'Lua Script (Generated)' | 'JSON'>('NGINX Config');
  const [copied, setCopied] = useState(false);

  const code = responseCode.split(' ')[0] || '403';

  const nginxLines = [
    'location / {',
    ...conditions.flatMap((c) => [
      `    if (${c.field === 'Query Parameter' ? '$arg_*' : c.field === 'Request Body' ? '$request_body' : '$request_uri'} ~* "${c.value || '.*'}") {`,
      `        return ${code};`,
      `    }`,
    ]),
    '}',
  ];

  const luaSnippet = `-- Aurora WAF Lua Generated Rule
local uri = ngx.var.request_uri
local body = ngx.var.request_body or ""
${conditions
  .map(
    (c) =>
      `if ngx.re.find(uri, [=[${c.value}]=], "ijo") then\n    return ngx.exit(${code})\nend`
  )
  .join('\n')}`;

  const jsonSnippet = JSON.stringify(
    {
      name,
      policy,
      priority,
      action: { type: 'BLOCK', status: parseInt(code) || 403 },
      conditions: conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        pattern: c.value,
      })),
    },
    null,
    2
  );

  const handleCopy = () => {
    const text =
      tab === 'NGINX Config'
        ? nginxLines.join('\n')
        : tab === 'Lua Script (Generated)'
        ? luaSnippet
        : jsonSnippet;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col font-sans text-xs">
      <div className="pb-2 border-b border-[#152030]">
        <div className="text-sm font-semibold text-white">Rule Preview</div>
        <div className="text-[11px] text-slate-400 font-sans mt-0.5">
          This is how the rule will be represented in the system (NGINX + Lua).
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#152030] bg-[#080E18] mt-3">
        {(['NGINX Config', 'Lua Script (Generated)', 'JSON'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 transition-colors cursor-pointer text-[11px] ${
              tab === t
                ? 'text-cyan-400 border-b-2 border-cyan-400 font-semibold bg-[#0B1320]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#0E1726]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Code Area with Line Numbers */}
      <div className="relative mt-3 p-3 bg-[#04070D] border border-[#1C293D] overflow-x-auto text-[11px] leading-relaxed">
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2.5 right-2.5 p-1 bg-[#152030] hover:bg-[#1C293D] text-slate-300 hover:text-white transition-colors cursor-pointer"
          title="Copy snippet"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>

        {tab === 'NGINX Config' && (
          <div className="font-mono text-slate-300">
            {nginxLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-6 text-slate-600 select-none text-right pr-3 shrink-0">
                  {i + 1}
                </span>
                <span className="text-rose-300">{line}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'Lua Script (Generated)' && (
          <pre className="text-cyan-300 whitespace-pre-wrap">{luaSnippet}</pre>
        )}

        {tab === 'JSON' && (
          <pre className="text-emerald-300 whitespace-pre-wrap">{jsonSnippet}</pre>
        )}
      </div>
    </div>
  );
}
