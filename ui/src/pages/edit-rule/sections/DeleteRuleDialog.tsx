import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, X, Check, Loader2 } from 'lucide-react';

interface DeleteRuleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: () => Promise<void> | void;
  ruleName: string;
  ruleId?: string;
  isDeleting?: boolean;
}

export function DeleteRuleDialog({
  isOpen,
  onClose,
  onConfirmDelete,
  ruleName,
  ruleId,
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
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xs bg-destructive/10 border border-destructive/20 text-destructive">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Delete Security Rule
              </h3>
              <p className="text-[11px] text-muted-foreground font-mono">
                Are you sure you want to delete this rule?
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit}>
          <div className="p-5 space-y-4">
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xs text-xs space-y-1.5">
              <div className="font-semibold text-destructive flex items-center gap-1.5">
                <span>Warning: Irreversible Action</span>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                This will permanently delete the rule{' '}
                <strong className="text-foreground font-mono">{ruleName}</strong> from Aurora WAF.
                Traffic previously matched by this rule will no longer be inspected or blocked by it.
              </p>
            </div>

            {/* Rule Metadata preview */}
            <div className="bg-muted/40 border border-border p-3 rounded-xs space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rule Name:</span>
                <span className="text-foreground font-semibold truncate max-w-[200px]">{ruleName}</span>
              </div>
              {ruleId && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rule ID:</span>
                  <span className="text-muted-foreground truncate max-w-[200px]">{ruleId}</span>
                </div>
              )}
            </div>

            {/* Type to confirm */}
            <div className="space-y-1.5">
              <label
                htmlFor="confirm-rule-name-input"
                className="block text-xs font-sans text-muted-foreground"
              >
                To confirm, type{' '}
                <code className="px-1 py-0.5 bg-muted text-destructive font-mono text-[11px] rounded-xs font-semibold">
                  {ruleName}
                </code>{' '}
                in the box below:
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
                  className={`w-full py-2 pl-3 pr-8 bg-background border text-foreground rounded-xs font-mono text-xs focus:outline-none transition-colors ${isMatched
                      ? 'border-primary focus:border-primary'
                      : 'border-input focus:border-destructive'
                    }`}
                />
                {isMatched && (
                  <Check className="w-4 h-4 text-primary absolute right-2.5 top-2.5 pointer-events-none animate-in zoom-in-50 duration-150" />
                )}
              </div>
              {!isMatched && confirmInput.length > 0 && (
                <p className="text-[11px] font-sans text-muted-foreground">
                  Name does not match yet.
                </p>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-border bg-muted/40">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="px-3.5 py-1.5 bg-muted hover:bg-accent border border-border text-foreground text-xs font-sans rounded-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={!isMatched || isDeleting}
              className="px-4 py-1.5 bg-destructive hover:bg-destructive/90 disabled:bg-muted text-destructive-foreground disabled:text-muted-foreground text-xs font-semibold font-sans rounded-xs shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
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
