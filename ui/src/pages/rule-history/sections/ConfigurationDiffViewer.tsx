import React, { useState } from 'react';
import type { RuleVersion } from '../types';
import { Copy, Check, ChevronDown } from 'lucide-react';

interface ConfigurationDiffViewerProps {
  versions: RuleVersion[];
  fromVersion: number;
  toVersion: number;
  ruleName?: string;
  onChangeFromVersion: (version: number) => void;
  onChangeToVersion: (version: number) => void;
}

export function ConfigurationDiffViewer({
  versions,
  fromVersion,
  toVersion,
  ruleName,
  onChangeFromVersion,
  onChangeToVersion,
}: ConfigurationDiffViewerProps) {
  const [copiedLeft, setCopiedLeft] = useState(false);
  const [copiedRight, setCopiedRight] = useState(false);

  const fromObj = versions.find((v) => v.version === fromVersion) || versions[versions.length - 1];
  const toObj = versions.find((v) => v.version === toVersion) || versions[0];

  const getCleanConfig = (v?: RuleVersion) => {
    if (!v) return {};
    return {
      name: ruleName || v.description || 'rule',
      priority: v.priority || 100,
      policy: v.policy || 'Default WAF Policy',
      description: v.description,
      conditions: v.conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value,
        ...(c.headerName ? { header_name: c.headerName } : {}),
      })),
      action: {
        type: v.action,
        response_code: v.responseCode || 403,
      },
    };
  };

  const leftConfig = getCleanConfig(fromObj);
  const rightConfig = getCleanConfig(toObj);

  const leftLines = JSON.stringify(leftConfig, null, 2).split('\n');
  const rightLines = JSON.stringify(rightConfig, null, 2).split('\n');

  // Simple and precise diff detection for line highlighting
  const isLineRemoved = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '{' || trimmed === '}' || trimmed === '[' || trimmed === '],') {
      return false;
    }
    return !rightLines.some((r) => r.trim() === trimmed);
  };

  const isLineAdded = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '{' || trimmed === '}' || trimmed === '[' || trimmed === '],') {
      return false;
    }
    return !leftLines.some((l) => l.trim() === trimmed);
  };

  const handleCopyLeft = () => {
    navigator.clipboard.writeText(JSON.stringify(leftConfig, null, 2));
    setCopiedLeft(true);
    setTimeout(() => setCopiedLeft(false), 2000);
  };

  const handleCopyRight = () => {
    navigator.clipboard.writeText(JSON.stringify(rightConfig, null, 2));
    setCopiedRight(true);
    setTimeout(() => setCopiedRight(false), 2000);
  };

  return (
    <div id="configuration-diff-section" className="bg-card border border-border rounded-xs p-4 shadow-xs">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Configuration Diff
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
            Compare the changes between <span className="font-mono">{fromObj?.versionLabel || `v${fromVersion}`}</span> and{' '}
            <span className="font-mono">{toObj?.versionLabel || `v${toVersion}`}</span>.
          </p>
        </div>

        {/* Dropdowns */}
        <div className="flex items-center gap-3 font-sans text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">From Version</span>
            <div className="relative">
              <select
                value={fromVersion}
                onChange={(e) => onChangeFromVersion(Number(e.target.value))}
                className="appearance-none bg-slate-100 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-800 dark:text-slate-200 py-1 pl-2.5 pr-7 rounded-xs text-xs font-mono focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.versionLabel}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">To Version</span>
            <div className="relative">
              <select
                value={toVersion}
                onChange={(e) => onChangeToVersion(Number(e.target.value))}
                className="appearance-none bg-slate-100 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-800 dark:text-slate-200 py-1 pl-2.5 pr-7 rounded-xs text-xs font-mono focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.versionLabel}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-side JSON diff viewer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left Side: Previous Version */}
        <div className="border border-border rounded-xs overflow-hidden bg-slate-50/50 dark:bg-[#080E18]">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-[#0E1726] border-b border-border text-xs font-sans">
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              Previous Version (<span className="font-mono">{fromObj?.versionLabel || `v${fromVersion}`}</span>)
            </span>
            <button
              type="button"
              onClick={handleCopyLeft}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 rounded-xs cursor-pointer"
              title="Copy JSON"
            >
              {copiedLeft ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="p-3 font-mono text-[11px] leading-relaxed overflow-x-auto select-text">
            {leftLines.map((line, idx) => {
              const removed = isLineRemoved(line);
              return (
                <div
                  key={idx}
                  className={`flex items-start ${
                    removed
                      ? 'bg-rose-500/15 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 -mx-3 px-3 border-l-2 border-rose-500 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="w-6 shrink-0 text-slate-400 dark:text-slate-600 select-none text-right pr-2">
                    {idx + 1}
                  </span>
                  <span className="whitespace-pre">{line}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Selected Version */}
        <div className="border border-border rounded-xs overflow-hidden bg-slate-50/50 dark:bg-[#080E18]">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-[#0E1726] border-b border-border text-xs font-sans">
            <span className="text-slate-700 dark:text-slate-300 font-medium">
              Selected Version (<span className="font-mono">{toObj?.versionLabel || `v${toVersion}`}</span>)
            </span>
            <button
              type="button"
              onClick={handleCopyRight}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 rounded-xs cursor-pointer"
              title="Copy JSON"
            >
              {copiedRight ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          <div className="p-3 font-mono text-[11px] leading-relaxed overflow-x-auto select-text">
            {rightLines.map((line, idx) => {
              const added = isLineAdded(line);
              return (
                <div
                  key={idx}
                  className={`flex items-start ${
                    added
                      ? 'bg-emerald-500/15 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 -mx-3 px-3 border-l-2 border-emerald-500 font-medium'
                      : 'text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="w-6 shrink-0 text-slate-400 dark:text-slate-600 select-none text-right pr-2">
                    {idx + 1}
                  </span>
                  <span className="whitespace-pre">{line}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
