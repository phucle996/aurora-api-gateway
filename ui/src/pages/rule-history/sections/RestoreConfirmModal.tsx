import React from 'react';
import type { RuleVersion } from '../types';
import { RotateCcw, AlertTriangle, X, Check, Loader2 } from 'lucide-react';

interface RestoreConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (targetVersion: number) => Promise<void> | void;
  targetVersion: RuleVersion | null;
  nextVersionNumber: number;
  isRestoring: boolean;
}

export function RestoreConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  targetVersion,
  nextVersionNumber,
  isRestoring,
}: RestoreConfirmModalProps) {
  if (!isOpen || !targetVersion) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="bg-card border border-border w-full max-w-md rounded-xs shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-slate-50/50 dark:bg-[#0E1726]/60">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xs bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60 text-amber-600 dark:text-amber-400">
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Restore Configuration
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Rollback to {targetVersion.versionLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isRestoring}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors rounded-xs cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 rounded-xs text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              Restoring will rollback all rule match conditions and action settings to the snapshot from{' '}
              <strong className="font-mono">{targetVersion.versionLabel}</strong>. A new active revision (
              <strong className="font-mono">v{nextVersionNumber}</strong>) will be recorded in the audit trail.
            </div>
          </div>

          {/* Snapshot Summary */}
          <div className="border border-border rounded-xs p-3 bg-slate-50/50 dark:bg-[#080E18] space-y-2 text-xs font-mono">
            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
              Configuration to be restored:
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Target Revision:</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">{targetVersion.versionLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Action:</span>
              <span className="text-slate-800 dark:text-slate-200">{targetVersion.action}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Match Conditions:</span>
              <span className="text-slate-800 dark:text-slate-200">{targetVersion.conditions.length} condition(s)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Created Date:</span>
              <span className="text-slate-700 dark:text-slate-300">{targetVersion.dateTime}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-border bg-slate-50/50 dark:bg-[#0E1726]/60">
          <button
            type="button"
            onClick={onClose}
            disabled={isRestoring}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-300 text-xs font-mono rounded-xs transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() => onConfirm(targetVersion.version)}
            disabled={isRestoring}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold font-mono rounded-xs shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            {isRestoring ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Restoring...</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Confirm Restore</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
