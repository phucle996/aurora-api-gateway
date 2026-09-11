import React from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-card border border-border/80 rounded-2xl shadow-2xl p-6 font-sans">
        <div className="flex items-center gap-3 text-destructive mb-3">
          <div className="p-2.5 rounded-xl bg-destructive/10">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            Delete L4 Service
          </h3>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Are you sure you want to delete L4 stream service{' '}
          <strong className="text-foreground">"{service.name}"</strong>?
          This will stop proxying raw traffic on its configured listener port immediately.
        </p>

        <div className="flex items-center justify-end gap-2.5 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-destructive-foreground bg-destructive hover:bg-destructive/90 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {isDeleting ? 'Deleting...' : 'Delete Service'}
          </button>
        </div>
      </div>
    </div>
  );
}

