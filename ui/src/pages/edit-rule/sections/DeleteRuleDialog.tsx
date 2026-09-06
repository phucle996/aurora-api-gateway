import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, X, Check, Loader2 } from 'lucide-react';

interface DeleteRuleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: () => Promise<void> | void;
  ruleName: string;
  isDeleting?: boolean;
}

export function DeleteRuleDialog({
  isOpen,
  onClose,
  onConfirmDelete,
  ruleName,
  isDeleting = false,
}: DeleteRuleDialogProps) {
  const [confirmInput, setConfirmInput] = useState('');

  // Reset input when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setConfirmInput('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isMatched = confirmInput.trim() === ruleName.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMatched && !isDeleting) {
      onConfirmDelete();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="bg-card border border-border w-full max-w-md rounded-xs shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-slate-50/50 dark:bg-[#0E1726]/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xs bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Delete Security Rule
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Are you sure you want to delete this rule?
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors rounded-xs cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4">
            {/* Warning Message */}
            <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50 rounded-xs text-xs text-rose-900 dark:text-rose-300 flex items-start gap-2.5 leading-relaxed">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                This action is <strong className="font-semibold">permanent</strong> and cannot be undone. This will permanently delete the security rule{' '}
                <span className="font-mono font-bold text-rose-700 dark:text-rose-300">
                  {ruleName}
                </span>{' '}
                and remove its configuration from runtime.
              </div>
            </div>

            {/* Input prompt */}
            <div className="space-y-2">
              <label
                htmlFor="confirm-rule-name-input"
                className="block text-xs font-mono text-slate-700 dark:text-slate-300"
              >
                To confirm deletion, please type{' '}
                <span className="font-bold text-rose-600 dark:text-rose-400 underline underline-offset-2 select-all">
                  {ruleName}
                </span>{' '}
                below:
              </label>

              <div className="relative">
                <input
                  id="confirm-rule-name-input"
                  type="text"
                  autoFocus
                  autoComplete="off"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={`Type "${ruleName}" to confirm`}
                  disabled={isDeleting}
                  className={`w-full py-2 pl-3 pr-8 bg-slate-100 dark:bg-[#0E1726] border text-slate-900 dark:text-white rounded-xs font-mono text-xs focus:outline-none transition-colors ${
                    isMatched
                      ? 'border-emerald-500 focus:border-emerald-500'
                      : 'border-slate-300 dark:border-[#1C293D] focus:border-rose-500'
                  }`}
                />
                {isMatched && (
                  <Check className="w-4 h-4 text-emerald-500 absolute right-2.5 top-2.5 pointer-events-none animate-in zoom-in-50 duration-150" />
                )}
              </div>
              {!isMatched && confirmInput.length > 0 && (
                <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                  Name does not match yet.
                </p>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-border bg-slate-50/50 dark:bg-[#0E1726]/60">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-300 text-xs font-mono rounded-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!isMatched || isDeleting}
              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-200 dark:disabled:bg-[#1C293D] text-white disabled:text-slate-400 dark:disabled:text-slate-600 text-xs font-semibold font-mono rounded-xs shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Deleting...</span>
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Rule</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
