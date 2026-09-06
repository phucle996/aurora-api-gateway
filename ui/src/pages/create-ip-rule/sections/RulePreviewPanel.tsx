import React, { useState } from 'react';
import { Copy, Check, FileCode, CheckCircle2 } from 'lucide-react';
import type { AccessRuleDocument } from '../../../lib/api/access';

interface RulePreviewProps {
  form: AccessRuleDocument;
  values: string;
}

export function RulePreviewPanel({ form, values }: RulePreviewProps) {
  const [activeTab, setActiveTab] = useState<'nginx' | 'json' | 'summary'>('nginx');
  const [copied, setCopied] = useState(false);

  const rawValues = values
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);

  const hasValues = rawValues.length > 0;

  // 1. Generate NGINX config representation
  const generateNginxLines = (): { num: number; content: React.ReactNode }[] => {
    const lines: { num: number; content: React.ReactNode }[] = [];
    let lineNo = 1;

    lines.push({
      num: lineNo++,
      content: (
        <span className="text-slate-400">
          # Access control rule: {form.name || '(unnamed rule)'}
        </span>
      ),
    });
    lines.push({
      num: lineNo++,
      content: <span className="text-slate-400"># Generated runtime preview</span>,
    });
    lines.push({ num: lineNo++, content: <span>&nbsp;</span> });
    lines.push({
      num: lineNo++,
      content: (
        <span className="text-slate-400">
          # Scope: <span className="text-cyan-400">{form.host === '*' ? 'all domains' : form.host}</span>
          {form.path_prefix && form.path_prefix !== '/' ? ` on path ${form.path_prefix}` : ''}
        </span>
      ),
    });
    lines.push({ num: lineNo++, content: <span>&nbsp;</span> });

    if (!hasValues) {
      lines.push({
        num: lineNo++,
        content: (
          <span className="text-amber-500/80 italic font-mono">
            # Awaiting input: enter IP addresses, CIDRs or select an IP group on the left.
          </span>
        ),
      });
      return lines;
    }

    const directive = form.action === 'block' ? 'deny' : form.action === 'allow' ? 'allow' : '# log';
    const directiveColor =
      form.action === 'block'
        ? 'text-rose-500 font-semibold'
        : form.action === 'allow'
        ? 'text-emerald-500 font-semibold'
        : 'text-cyan-500';

    rawValues.slice(0, 10).forEach((val) => {
      lines.push({
        num: lineNo++,
        content: (
          <span>
            <span className={directiveColor}>{directive}</span>{' '}
            <span className="text-slate-800 dark:text-slate-200">{val}</span>;
          </span>
        ),
      });
    });

    if (rawValues.length > 10) {
      lines.push({
        num: lineNo++,
        content: (
          <span className="text-slate-400">
            # ... and {rawValues.length - 10} more entries
          </span>
        ),
      });
    }

    lines.push({ num: lineNo++, content: <span>&nbsp;</span> });
    lines.push({
      num: lineNo++,
      content: <span className="text-slate-400"># Compiled deterministically into access release</span>,
    });

    return lines;
  };

  // 2. Generate JSON representation
  const jsonObject = {
    name: form.name || '(unnamed rule)',
    description: form.description || '',
    action: form.action,
    enabled: form.enabled,
    priority: form.priority,
    source: form.source,
    values: rawValues,
    host: form.host,
    path_prefix: form.path_prefix,
    method: form.method,
    schedule: form.schedule,
    expires_at: form.expires_at,
    log: form.log,
    reputation: form.reputation,
    alert: form.alert,
  };

  const jsonString = JSON.stringify(jsonObject, null, 2);

  const handleCopy = () => {
    let contentToCopy = '';
    if (activeTab === 'json') {
      contentToCopy = jsonString;
    } else if (activeTab === 'nginx') {
      if (!hasValues) {
        contentToCopy = '# No source targets defined yet.';
      } else {
        const directive = form.action === 'block' ? 'deny' : form.action === 'allow' ? 'allow' : '# log';
        contentToCopy = rawValues.map((val) => `${directive} ${val};`).join('\n');
      }
    } else {
      contentToCopy = JSON.stringify(jsonObject, null, 2);
    }

    navigator.clipboard.writeText(contentToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const nginxLines = generateNginxLines();

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] shadow-xs rounded-sm font-sans text-xs overflow-hidden">
      {/* Header & Tabs */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50/50 dark:bg-[#080E18] border-b border-slate-200 dark:border-[#172338]">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('nginx')}
            className={`px-2.5 py-1 font-medium rounded text-xs transition-colors cursor-pointer ${
              activeTab === 'nginx'
                ? 'bg-white dark:bg-[#152030] text-slate-900 dark:text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            NGINX Config
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('json')}
            className={`px-2.5 py-1 font-medium rounded text-xs transition-colors cursor-pointer ${
              activeTab === 'json'
                ? 'bg-white dark:bg-[#152030] text-slate-900 dark:text-white shadow-xs font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            JSON Document
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer text-xs"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Display Area */}
      <div className="p-4 bg-[#0F172A] text-slate-300 font-mono text-[11px] leading-relaxed overflow-x-auto min-h-[160px] max-h-[300px]">
        {activeTab === 'nginx' ? (
          <table className="w-full border-collapse">
            <tbody>
              {nginxLines.map((l) => (
                <tr key={l.num} className="hover:bg-slate-800/40">
                  <td className="w-8 select-none text-right pr-4 text-slate-600 dark:text-slate-600 align-top">
                    {l.num}
                  </td>
                  <td className="whitespace-pre align-top">{l.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <pre className="whitespace-pre overflow-x-auto text-slate-200">
            {jsonString}
          </pre>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 bg-slate-50/50 dark:bg-[#080E18] border-t border-slate-200 dark:border-[#172338] text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <FileCode className="w-3 h-3 text-slate-400" />
          <span>Real-time snapshot preview</span>
        </span>
        <span className="font-mono">
          {rawValues.length} {rawValues.length === 1 ? 'target' : 'targets'}
        </span>
      </div>
    </section>
  );
}
