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
      <div className="relative w-full max-w-lg bg-card border-l border-border shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-5 border-b border-border flex items-start justify-between gap-3 bg-muted/20">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-bold text-foreground truncate max-w-sm">
                {docName}
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="uppercase font-mono text-[10px] px-1.5 py-0.2 rounded-xs bg-muted text-muted-foreground font-semibold border border-border">
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
            className="text-muted-foreground hover:text-foreground p-1 rounded-xs hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 no-scrollbar">
          <div className="text-xs text-muted-foreground">
            Chronological revision log with immutable audit snapshots. You can rollback to any previous version at any time.
          </div>

          {history.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs font-mono">
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
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-muted/20'
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
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}

                        <span className="font-mono text-xs font-bold text-foreground">
                          v{row.version}
                        </span>

                        {isCurrent && (
                          <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-mono font-semibold bg-primary/10 text-primary border border-primary/20">
                            ACTIVE
                          </span>
                        )}

                        {row.deleted ? (
                          <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-mono font-semibold bg-destructive/10 text-destructive border border-destructive/20">
                            DELETED
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.2 rounded-xs text-[10px] font-mono font-semibold bg-muted text-muted-foreground border border-border">
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
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 border border-primary/30 rounded-xs transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restore</span>
                        </button>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="px-3.5 pb-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{row.actor || 'system'}</span>
                      </div>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                        <span>{new Date(row.updated_at).toLocaleString()}</span>
                      </div>
                    </div>

                    {/* Collapsible Document Body */}
                    {isExpanded && (
                      <div className="p-3 border-t border-border bg-card space-y-2">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-mono uppercase">Snapshot Document</span>
                          <button
                            type="button"
                            onClick={() => handleCopyJson(row.version, row.document)}
                            className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
                          >
                            {copiedVersion === row.version ? (
                              <>
                                <Check className="w-3 h-3 text-primary" />
                                <span className="text-primary">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy JSON</span>
                              </>
                            )}
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono text-foreground overflow-x-auto p-2.5 bg-muted/40 border border-border rounded-xs max-h-56 no-scrollbar">
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
        <div className="p-4 border-t border-border flex items-center justify-end bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold text-foreground border border-border rounded-xs hover:bg-muted transition-colors cursor-pointer"
          >
            Close Drawer
          </button>
        </div>
      </div>
    </div>
  );
}
