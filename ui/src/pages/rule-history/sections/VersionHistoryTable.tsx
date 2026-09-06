import React, { useState } from 'react';
import type { RuleVersion } from '../types';
import { MoreHorizontal, RotateCcw, Copy, Check, Eye, GitCompare } from 'lucide-react';

interface VersionHistoryTableProps {
  versions: RuleVersion[];
  selectedVersion: number;
  onSelectVersion: (version: number) => void;
  onCompareVersion: (version: number) => void;
  onRestoreVersion: (version: number) => void;
}

export function VersionHistoryTable({
  versions,
  selectedVersion,
  onSelectVersion,
  onCompareVersion,
  onRestoreVersion,
}: VersionHistoryTableProps) {
  const [activeMenuVersion, setActiveMenuVersion] = useState<number | null>(null);
  const [copiedVersion, setCopiedVersion] = useState<number | null>(null);

  const handleCopyJson = (v: RuleVersion, e: React.MouseEvent) => {
    e.stopPropagation();
    const jsonStr = v.rawJson || JSON.stringify(v, null, 2);
    navigator.clipboard.writeText(jsonStr);
    setCopiedVersion(v.version);
    setActiveMenuVersion(null);
    setTimeout(() => setCopiedVersion(null), 2000);
  };

  const getBadgeClass = (changeType: string) => {
    switch (changeType) {
      case 'Logic Update':
        return 'bg-primary/10 text-primary border border-primary/20';
      case 'Condition Update':
        return 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/60';
      case 'Initial Creation':
        return 'bg-muted text-foreground border border-border';
      case 'Rollback Restore':
        return 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:text-purple-400 dark:border-purple-900/60';
      default:
        return 'bg-muted text-foreground border border-border';
    }
  };

  return (
    <div className="bg-card border border-border rounded-xs p-4 shadow-xs">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Version History
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-sans">
          All versions of this rule, including changes and deployment history.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-border text-slate-500 dark:text-slate-400 font-sans text-[11px]">
              <th className="py-2.5 px-3 font-medium">Version</th>
              <th className="py-2.5 px-3 font-medium">Date / Time</th>
              <th className="py-2.5 px-3 font-medium">Changed By</th>
              <th className="py-2.5 px-3 font-medium">Change Type</th>
              <th className="py-2.5 px-3 font-medium">Summary of Changes</th>
              <th className="py-2.5 px-3 font-medium">Deployment Status</th>
              <th className="py-2.5 px-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {versions.map((v) => {
              const isSelected = v.version === selectedVersion;
              return (
                <tr
                  key={v.version}
                  onClick={() => onSelectVersion(v.version)}
                  className={`transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-primary/10'
                      : 'hover:bg-muted/60'
                  }`}
                >
                  {/* Version */}
                  <td className="py-3 px-3 font-mono font-bold text-primary">
                    {v.versionLabel}
                  </td>

                  {/* Date / Time */}
                  <td className="py-3 px-3 font-mono text-slate-600 dark:text-slate-300 text-[11px] whitespace-nowrap">
                    {v.dateTime}
                  </td>

                  {/* Changed By */}
                  <td className="py-3 px-3 font-sans text-slate-700 dark:text-slate-300">
                    {v.changedBy}
                  </td>

                  {/* Change Type */}
                  <td className="py-3 px-3 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-xs text-[10px] font-medium ${getBadgeClass(
                        v.changeType
                      )}`}
                    >
                      {v.changeType}
                    </span>
                  </td>

                  {/* Summary of Changes */}
                  <td className="py-3 px-3 text-slate-700 dark:text-slate-300 max-w-[280px] truncate">
                    {v.summaryOfChanges}
                  </td>

                  {/* Deployment Status */}
                  <td className="py-3 px-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5 font-medium">
                      {v.deploymentStatus === 'Active' ? (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                          <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
                            Active
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 inline-block" />
                          <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                            Archived
                          </span>
                        </>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2.5 relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectVersion(v.version);
                        }}
                        className="text-primary hover:underline font-medium cursor-pointer"
                      >
                        View
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCompareVersion(v.version);
                        }}
                        className="text-primary hover:underline font-medium cursor-pointer"
                      >
                        Compare
                      </button>

                      {/* Dropdown Menu */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuVersion(
                              activeMenuVersion === v.version ? null : v.version
                            );
                          }}
                          className="p-1 hover:bg-accent rounded-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>

                        {activeMenuVersion === v.version && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-0 top-full mt-1 w-44 bg-card border border-border shadow-lg rounded-xs py-1 z-30 font-sans text-xs"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveMenuVersion(null);
                                onRestoreVersion(v.version);
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-muted text-foreground flex items-center gap-2 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3 text-amber-500" />
                              <span>Restore to {v.versionLabel}</span>
                            </button>

                            <button
                              type="button"
                              onClick={(e) => handleCopyJson(v, e)}
                              className="w-full text-left px-3 py-1.5 hover:bg-muted text-foreground flex items-center gap-2 cursor-pointer"
                            >
                              {copiedVersion === v.version ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-500" />
                                  <span className="text-emerald-500">Copied JSON</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-400" />
                                  <span>Copy Version JSON</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
