import React from 'react';
import { AlertCircle } from 'lucide-react';

interface DeleteL4ServiceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  service: { id: string; name: string } | null;
  onConfirm: () => Promise<void>;
  isDeleting: boolean;
}

export function DeleteL4ServiceDialog({
  isOpen,
  onClose,
  service,
  onConfirm,
  isDeleting,
}: DeleteL4ServiceDialogProps) {
  if (!isOpen || !service) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md bg-card border border-border/60 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-3 text-destructive">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <h3 className="font-semibold text-lg text-foreground">Confirm Deletion</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete L4 service{' '}
          <span className="font-bold text-foreground">"{service.name}"</span>?
          This will stop proxying traffic on this listener port immediately.
        </p>
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border/40">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive hover:bg-destructive/90 text-white transition-all shadow-sm disabled:opacity-50"
          >
            {isDeleting ? 'Deleting...' : 'Delete Service'}
          </button>
        </div>
      </div>
    </div>
  );
}
