import React from 'react';
import { Database, Code2, FolderTree, Bot, FileCode, ChevronRight } from 'lucide-react';
import type { Condition } from './MatchConditionsSection';

export interface TemplateData {
  name: string;
  description: string;
  field: string;
  operator: string;
  pattern: string;
}

interface RuleTemplatesProps {
  onSelectTemplate: (t: TemplateData) => void;
}

export function RuleTemplatesPanel({ onSelectTemplate }: RuleTemplatesProps) {
  const templates: Array<{
    title: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    data: TemplateData;
  }> = [
    {
      title: 'SQL Injection Protection',
      description: 'Block common SQL injection patterns',
      icon: <Database className="w-4 h-4" />,
      color: 'text-rose-400 bg-rose-950/30 border-rose-500/30',
      data: {
        name: 'block-sql-injection',
        description: 'Block common SQL injection patterns in URI and query parameters.',
        field: 'Request URI',
        operator: 'Contains (Pattern)',
        pattern: '(?i)(union|select|insert|drop|or\\s+1=1)',
      },
    },
    {
      title: 'XSS Protection',
      description: 'Block cross-site scripting attempts',
      icon: <Code2 className="w-4 h-4" />,
      color: 'text-orange-400 bg-orange-950/30 border-orange-500/30',
      data: {
        name: 'block-xss-attacks',
        description: 'Block cross-site scripting payloads in script tags and attributes.',
        field: 'Request URI',
        operator: 'Contains (Pattern)',
        pattern: '(?i)(<script|javascript:|onerror=|onload=)',
      },
    },
    {
      title: 'Path Traversal Protection',
      description: 'Block directory traversal requests',
      icon: <FolderTree className="w-4 h-4" />,
      color: 'text-emerald-400 bg-emerald-950/30 border-emerald-500/30',
      data: {
        name: 'block-path-traversal',
        description: 'Block path traversal directory walking sequences.',
        field: 'Request Path',
        operator: 'Contains (Pattern)',
        pattern: '(\\.\\./|\\.\\.\\\\|%2e%2e)',
      },
    },
    {
      title: 'Bad Bot Protection',
      description: 'Block known bad bots and scanners',
      icon: <Bot className="w-4 h-4" />,
      color: 'text-purple-400 bg-purple-950/30 border-purple-500/30',
      data: {
        name: 'block-bad-bots',
        description: 'Block automated scanners, exploit probes, and malicious user agents.',
        field: 'Request Header',
        operator: 'Contains (Pattern)',
        pattern: '(?i)(sqlmap|nikto|nmap|masscan|zgrab)',
      },
    },
    {
      title: 'Custom Rule (Blank)',
      description: 'Start with an empty rule',
      icon: <FileCode className="w-4 h-4" />,
      color: 'text-cyan-400 bg-cyan-950/30 border-cyan-500/30',
      data: {
        name: 'custom-waf-rule',
        description: 'Custom security rule for edge filtering.',
        field: 'Request URI',
        operator: 'Contains (Pattern)',
        pattern: '.*',
      },
    },
  ];

  return (
    <div id="rule-templates" className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col font-sans text-xs">
      <div className="pb-2 border-b border-[#152030]">
        <div className="text-sm font-semibold text-white">Common Rule Templates</div>
        <div className="text-[11px] text-slate-400 font-sans mt-0.5">
          Start from a template and customize it for your needs.
        </div>
      </div>

      <div className="space-y-2 mt-3">
        {templates.map((tmpl) => (
          <div
            key={tmpl.title}
            onClick={() => onSelectTemplate(tmpl.data)}
            className="p-2.5 bg-[#080E18] hover:bg-[#0E1726] border border-[#152030] hover:border-[#1C293D] flex items-center justify-between gap-3 cursor-pointer transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className={`p-1.5 border shrink-0 ${tmpl.color}`}>
                {tmpl.icon}
              </div>
              <div>
                <div className="font-semibold text-slate-200 group-hover:text-cyan-400 transition-colors">
                  {tmpl.title}
                </div>
                <div className="text-[11px] text-slate-500 font-sans">
                  {tmpl.description}
                </div>
              </div>
            </div>

            <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 transition-colors shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
