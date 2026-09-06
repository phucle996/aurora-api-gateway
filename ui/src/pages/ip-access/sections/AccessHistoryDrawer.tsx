import React, { useState } from 'react';
import {
  History,
  X,
  RotateCcw,
  User,
  Clock,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ShieldAlert,
} from 'lucide-react';
import type { AccessObject, AccessStatus } from '../../../lib/api/access';

interface AccessHistoryDrawerProps {
  selected: AccessObject | null;
  history: AccessObject[];
  busy: boolean;
  status: AccessStatus | null;
  onClose: () => void;
  onRestore: (item: AccessObject, version: number, document: unknown) => Promise<void>;
}

export function AccessHistoryDrawer({
  selected,
  history,
  busy,
  status,
  onClose,
  onRestore,
}: AccessHistoryDrawerProps) {
  const [expandedVersions, setExpandedVersions] = useState<{ [version: number]: boolean }>({});
  const [copiedVersion, setCopiedVersion] = useState<number | null>(null);

  if (!selected) return null;

  const toggleExpand = (version: number) => {
    setExpandedVersions((prev) => ({
      ...prev,
      [version]: !prev[version],
    }));
  };

  const handleCopyJson = (version: number, doc: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(doc, null, 2));
    setCopiedVersion(version);
    setTimeout(() => setCopiedVersion(null), 1500);
  };

  const docName =
    selected.document && typeof selected.document === 'object' && 'name' in selected.document
      ? String(selected.document.name)
      : `Item #${selected.id}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end font-sans">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-lg bg-white dark:bg-[#0B1320] border-l border-slate-200 dark:border-[#172338] shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-[#172338] flex items-start justify-between gap-3 bg-slate-50/50 dark:bg-[#080E18]/50">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-sm">
                {docName}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="uppercase font-mono text-[10px] px-1.5 py-0.2 rounded-xs bg-slate-100 dark:bg-[#152030] text-slate-600 dark:text-slate-300 font-semibold border border-slate-200 dark:border-[#1E2D45]">
                {selected.kind}
              </span>
              <span>•</span>
              <span className="font-mono text-[11px]">ID #{selected.id}</span>
              <span>•</span>
              <span className="font-mono text-[11px]">Current v{selected.version}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-xs hover:bg-slate-100 dark:hover:bg-[#152030] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Chronological revision log with immutable audit snapshots. You can rollback to any previous version at any time.
          </div>

          {history.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs font-mono">
              Loading revision timeline...
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((row) => {
                const isCurrent = row.version === selected.version;
                const isExpanded = expandedVersions[row.version] ?? isCurrent;

                return (
                  <div
                    key={row.version}
                    className={`border rounded-xs transition-colors ${
                      isCurrent
                        ? 'border-blue-300 dark:border-blue-900/80 bg-blue-50/20 dark:bg-blue-950/10'
                        : 'border-slate-200 dark:border-[#172338] bg-slate-50/40 dark:bg-[#080E18]/60'
                    }`}
                  >
                    {/* Item Header */}
                    <div className="p-3.5 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => toggleExpand(row.version)}
                        className="flex items-center gap-2 text-left cursor-pointer flex-1 min-w-0"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}

                        <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                          v{row.version}
                        </span>

                        {isCurrent && (
                          <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-mono font-semibold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                            ACTIVE
                          </span>
                        )}

                        {row.deleted ? (
                          <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-mono font-semibold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                            DELETED
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-mono font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                            SAVED
                          </span>
                        )}
                      </button>

                      {/* Restore Action */}
                      {!row.deleted && !isCurrent && (
                        <button
                          type="button"
                          disabled={busy || !status}
                          onClick={() => {
                            if (
                              confirm(
                                `Restore revision v${row.version} of “${docName}” and immediately apply to active release?`
                              )
                            ) {
                              void onRestore(selected, row.version, row.document);
                            }
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-xs transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restore</span>
                        </button>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="px-3.5 pb-2.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>{row.actor || 'system'}</span>
                      </div>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{new Date(row.updated_at).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Collapsible Document Body */}
                    {isExpanded && (
                      <div className="p-3 border-t border-slate-200 dark:border-[#172338] bg-white dark:bg-[#050911] space-y-2">
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span className="font-mono uppercase">Snapshot Document</span>
                          <button
                            type="button"
                            onClick={() => handleCopyJson(row.version, row.document)}
                            className="flex items-center gap-1 hover:text-slate-200 transition-colors cursor-pointer"
                          >
                            {copiedVersion === row.version ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy JSON</span>
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto p-2.5 bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] rounded-xs max-h-56 no-scrollbar">
                          {JSON.stringify(row.document, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-[#172338] flex items-center justify-end bg-slate-50/50 dark:bg-[#080E18]/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-[#1E2D45] rounded-xs hover:bg-slate-100 dark:hover:bg-[#152030] transition-colors cursor-pointer"
          >
            Close Drawer
          </button>
        </div>
      </div>
    </div>
  );
}
