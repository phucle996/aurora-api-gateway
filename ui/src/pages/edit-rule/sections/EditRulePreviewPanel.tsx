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
    <div className="bg-card border border-border p-4 flex flex-col font-sans text-xs">
      <div className="pb-2 border-b border-border">
        <div className="text-sm font-semibold text-foreground">Rule Preview</div>
        <div className="text-[11px] text-muted-foreground font-sans mt-0.5">
          This is how the rule will be represented in the system (NGINX + Lua).
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-muted/40 mt-3">
        {(['NGINX Config', 'Lua Script (Generated)', 'JSON'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 transition-colors cursor-pointer text-[11px] ${
              tab === t
                ? 'text-primary border-b-2 border-primary font-semibold bg-card'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Code Area with Line Numbers */}
      <div className="relative mt-3 p-3 bg-muted/30 border border-border overflow-x-auto text-[11px] leading-relaxed">
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2.5 right-2.5 p-1 bg-card hover:bg-accent text-foreground transition-colors cursor-pointer border border-border"
          title="Copy snippet"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-primary" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>

        {tab === 'NGINX Config' && (
          <div className="font-mono text-foreground">
            {nginxLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-6 text-muted-foreground select-none text-right pr-3 shrink-0">
                  {i + 1}
                </span>
                <span className="text-primary">{line}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'Lua Script (Generated)' && (
          <pre className="text-primary whitespace-pre-wrap">{luaSnippet}</pre>
        )}

        {tab === 'JSON' && (
          <pre className="text-primary whitespace-pre-wrap">{jsonSnippet}</pre>
        )}
      </div>
    </div>
  );
}
