import React from 'react';
import { Layers, Check } from 'lucide-react';

export interface RuleGroupOption {
  id: string;
  name: string;
  description: string;
}

export const availableRuleGroups: RuleGroupOption[] = [
  {
    id: 'sqli',
    name: 'SQL Injection',
    description: 'Detects SQL injection patterns',
  },
  {
    id: 'cmd-inject',
    name: 'Command Injection',
    description: 'Detects command injection attempts',
  },
  {
    id: 'rate-limit',
    name: 'Rate Limiting',
    description: 'Enforces request rate limits',
  },
  {
    id: 'xss',
    name: 'XSS',
    description: 'Blocks cross-site scripting attempts',
  },
  {
    id: 'bot-protection',
    name: 'Bad Bot Protection',
    description: 'Blocks automated and malicious bots',
  },
  {
    id: 'geo-block',
    name: 'Geo-blocking',
    description: 'Blocks requests from specified regions',
  },
  {
    id: 'path-traversal',
    name: 'Path Traversal',
    description: 'Prevents directory traversal attacks',
  },
  {
    id: 'sensitive-endpoint',
    name: 'Sensitive Endpoint Protection',
    description: 'Protects sensitive and administrative endpoints',
  },
  {
    id: 'threat-intel',
    name: 'Threat Intelligence',
    description: 'Uses threat intelligence feeds',
  },
];

interface RuleGroupsSectionProps {
  selectedGroupNames: string[];
  onToggleGroup: (name: string) => void;
}

export function RuleGroupsSection({
  selectedGroupNames,
  onToggleGroup,
}: RuleGroupsSectionProps) {
  return (
    <div className="bg-[#0B1320] border border-[#172338] p-5 space-y-4">
      {/* Section Header */}
      <div className="flex items-start gap-2.5 pb-2 border-b border-[#172338]">
        <div className="w-7 h-7 bg-[#0E1B2C] border border-[#1C3252] flex items-center justify-center text-slate-300">
          <Layers className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
            Rule Groups
          </h2>
          <p className="text-[11px] text-slate-400 font-mono">
            Select rule groups to apply to this policy. These rule groups will be enforced in the defined mode.
          </p>
        </div>
      </div>

      {/* Checkbox Grid (3 columns) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
        {availableRuleGroups.map((group) => {
          const isChecked = selectedGroupNames.includes(group.name);
          return (
            <div
              key={group.id}
              onClick={() => onToggleGroup(group.name)}
              className={`flex items-start gap-3 p-3 border transition-colors cursor-pointer select-none ${
                isChecked
                  ? 'bg-emerald-950/20 border-emerald-800/80 text-white'
                  : 'bg-[#0E1726]/60 border-[#1C293D] hover:border-[#2B3B52] text-slate-300'
              }`}
            >
              {/* Checkbox Box */}
              <div
                className={`w-4 h-4 mt-0.5 shrink-0 border flex items-center justify-center transition-colors ${
                  isChecked
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'border-[#2B3B52] bg-[#111A29]'
                }`}
              >
                {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
              </div>

              {/* Text Info */}
              <div className="space-y-0.5 min-w-0">
                <div className="text-xs font-bold font-sans tracking-tight">
                  {group.name}
                </div>
                <div className="text-[11px] text-slate-400 font-mono leading-relaxed">
                  {group.description}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
