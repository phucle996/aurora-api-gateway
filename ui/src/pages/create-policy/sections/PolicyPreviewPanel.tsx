import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import type { PolicyRuleItem } from './PolicyRulesSection';
import type { PolicyMode } from './BasicInfoSection';

interface PolicyPreviewPanelProps {
  name: string;
  description: string;
  mode: PolicyMode;
  priority: number;
  rules: PolicyRuleItem[];
  target: string;
  expectedVersion: number;
}

export function PolicyPreviewPanel({
  name,
  description,
  mode,
  priority,
  rules,
  target,
  expectedVersion,
}: PolicyPreviewPanelProps) {
  const [activeTab, setActiveTab] = useState<'draft' | 'runtime'>('draft');
  const [copied, setCopied] = useState(false);

  const cleanHost = target === 'All Domains' ? '*' : (target.trim() || '*');
  const activeRules = rules.filter((r) => r.enabled);

  // 1. Real Draft API Payload (PolicyDraft sent to control-plane)
  const draftPayload = {
    name: name || 'unnamed-policy',
    description: description || '',
    host: cleanHost,
    mode: mode,
    priority: priority,
    rule_ids: activeRules.map((r) => r.id),
    expected_version: expectedVersion,
  };

  const draftJsonString = JSON.stringify(draftPayload, null, 2);

  // 2. Real Runtime Snapshot (Compiled cluster representation distributed to NGINX nodes)
  const runtimeSnapshot = {
    schema_version: 1,
    generation: '<next_release_id>',
    policy: {
      host: cleanHost,
      priority: priority,
      mode: mode,
      rules: activeRules.map((r) => {
        let runtimeAction = r.action;
        if (mode === 'detect') {
          runtimeAction = 'throttle'; // mapped to log in detect mode
        } else if (mode === 'block' && r.action !== 'allow') {
          runtimeAction = 'block';
        }
        return {
          id: r.id,
          name: r.name,
          group: r.group || 'custom',
          action: r.action,
          runtime_action: mode === 'detect' ? 'log' : runtimeAction,
        };
      }),
    },
  };

  const runtimeJsonString = JSON.stringify(runtimeSnapshot, null, 2);

  const currentContent = activeTab === 'draft' ? draftJsonString : runtimeJsonString;
  const lines = currentContent.split('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  return (
    <section className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] shadow-xs rounded-sm overflow-hidden font-sans">
      {/* Header */}
      <div className="p-4 border-b border-slate-200 dark:border-[#152030]">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Policy Preview
        </h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
          Real control-plane contract & compiled node runtime snapshot.
        </p>
      </div>

      {/* Tabs & Copy Button */}
      <div className="flex items-center justify-between px-4 bg-slate-50 dark:bg-[#080E18] border-b border-slate-200 dark:border-[#152030] text-xs">
        <div className="flex">
          <button
            type="button"
            onClick={() => setActiveTab('draft')}
            className={`py-2 px-3 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeTab === 'draft'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Draft API Payload
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('runtime')}
            className={`py-2 px-3 border-b-2 font-semibold transition-colors cursor-pointer ${
              activeTab === 'runtime'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            Node Runtime Snapshot
          </button>
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2 py-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#152030] rounded-xs text-[11px] transition-colors cursor-pointer"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-500 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Display Box with Line Numbers */}
      <div className="p-3 bg-slate-100 dark:bg-slate-950 text-slate-800 dark:text-slate-100 text-[11px] overflow-x-auto leading-relaxed max-h-[380px] select-text">
        <div className="flex">
          {/* Line Numbers */}
          <div className="pr-3 text-right text-slate-400 dark:text-slate-600 select-none border-r border-slate-300 dark:border-slate-800 shrink-0 font-mono">
            {lines.map((_, i) => (
              <div key={i} className="leading-relaxed">
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code Lines */}
          <pre className="pl-3 font-mono text-slate-300 whitespace-pre overflow-x-auto flex-1">
            <code>
              {lines.map((line, idx) => {
                const isKey = line.match(/^(\s*)"([^"]+)":/);
                const isStringVal = line.match(/: "([^"]+)"/);
                const isBoolVal = line.match(/: (true|false)/);
                const isNumVal = line.match(/: (\d+)/);

                return (
                  <div key={idx} className="leading-relaxed">
                    {isKey ? (
                      <>
                        <span className="text-slate-400">{isKey[1]}</span>
                        <span className="text-cyan-400">"{isKey[2]}"</span>:
                        {isStringVal ? (
                          <>
                            {' '}
                            <span className="text-amber-300">"{isStringVal[1]}"</span>
                            {line.endsWith(',') ? ',' : ''}
                          </>
                        ) : isBoolVal ? (
                          <>
                            {' '}
                            <span className="text-blue-400">{isBoolVal[1]}</span>
                            {line.endsWith(',') ? ',' : ''}
                          </>
                        ) : isNumVal ? (
                          <>
                            {' '}
                            <span className="text-purple-400">{isNumVal[1]}</span>
                            {line.endsWith(',') ? ',' : ''}
                          </>
                        ) : (
                          line.substring(line.indexOf(':') + 1)
                        )}
                      </>
                    ) : (
                      line
                    )}
                  </div>
                );
              })}
            </code>
          </pre>
        </div>
      </div>
    </section>
  );
}

export default PolicyPreviewPanel;
