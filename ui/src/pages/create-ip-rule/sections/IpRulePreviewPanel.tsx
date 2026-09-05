import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface IpRulePreviewProps {
  name: string;
  action: string;
  priority: number;
  enabled: boolean;
  sourceType: string;
  countries: string[];
  ipValue: string;
  cidrValue: string;
  asnValue: string;
  groupValue: string;
  target: string;
  path: string;
  method: string;
  timeWindow: string;
  logEvent: boolean;
  addReputation: boolean;
  enableAlert: boolean;
}

export function IpRulePreviewPanel(props: IpRulePreviewProps) {
  const [copied, setCopied] = useState(false);

  // Build JSON object dynamically based on props
  let sourceObj: any = { type: props.sourceType };
  if (props.sourceType === 'country') {
    sourceObj.countries = props.countries.length > 0 ? props.countries : ['*'];
  } else if (props.sourceType === 'ip') {
    sourceObj.ip = props.ipValue || '127.0.0.1';
  } else if (props.sourceType === 'cidr') {
    sourceObj.cidr = props.cidrValue || '10.0.0.0/8';
  } else if (props.sourceType === 'asn') {
    sourceObj.asn = props.asnValue || 'AS13335';
  } else if (props.sourceType === 'group') {
    sourceObj.group = props.groupValue || 'trusted-partners';
  }

  const ruleJson = {
    name: props.name || 'unnamed-ip-rule',
    action: props.action,
    priority: props.priority,
    enabled: props.enabled,
    source: sourceObj,
    scope: {
      sites: props.target === '*' ? ['*'] : [props.target],
      path: props.path || '*',
      methods: props.method === '*' ? ['*'] : [props.method],
      time_window: props.timeWindow,
    },
    options: {
      log: props.logEvent,
      reputation: props.addReputation,
      alert: props.enableAlert,
    },
  };

  const jsonString = JSON.stringify(ruleJson, null, 2);
  const lines = jsonString.split('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 space-y-3 font-mono text-xs">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-white">Rule Preview</div>
          <p className="text-slate-400 text-[11px] font-sans">
            This is how the rule will be represented in the system.
          </p>
        </div>
      </div>

      <div className="relative bg-[#060A10] border border-[#152030] p-3 text-xs font-mono overflow-x-auto">
        <button
          type="button"
          onClick={handleCopy}
          className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 bg-[#0E1726] hover:bg-[#152030] border border-[#1C293D] text-slate-300 hover:text-white text-[11px] cursor-pointer transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>

        <div className="space-y-0.5 pt-1">
          {lines.map((line, idx) => (
            <div key={idx} className="flex leading-5">
              <span className="w-6 text-slate-600 select-none text-right pr-3 shrink-0">
                {idx + 1}
              </span>
              <span className="text-slate-300 whitespace-pre">
                {/* Simple syntax color highlights */}
                {line.split(/("(?:[^"\\]|\\.)*")/g).map((chunk, cIdx) => {
                  if (chunk.startsWith('"')) {
                    const isKey = line.indexOf(chunk) < line.indexOf(':');
                    return (
                      <span
                        key={cIdx}
                        className={isKey ? 'text-cyan-300' : 'text-rose-300'}
                      >
                        {chunk}
                      </span>
                    );
                  }
                  if (chunk.includes('true') || chunk.includes('false')) {
                    return (
                      <span key={cIdx} className="text-purple-400">
                        {chunk}
                      </span>
                    );
                  }
                  if (/\d+/.test(chunk)) {
                    return (
                      <span key={cIdx} className="text-amber-300">
                        {chunk}
                      </span>
                    );
                  }
                  return <span key={cIdx}>{chunk}</span>;
                })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
