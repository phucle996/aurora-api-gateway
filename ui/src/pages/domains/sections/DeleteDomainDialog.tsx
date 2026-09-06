import React from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';
import type { DomainItem } from '../types';

interface DeleteDomainDialogProps {
  isOpen: boolean;
  domain: DomainItem | null;
  onClose: () => void;
  onConfirm: (domain: DomainItem) => void;
}

export function DeleteDomainDialog({
  isOpen,
  domain,
  onClose,
  onConfirm,
}: DeleteDomainDialogProps) {
  if (!isOpen || !domain) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 rounded-full bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1.5 flex-1">
              <h3 className="font-bold text-base text-foreground">
                Delete Domain
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Are you sure you want to delete{' '}
                <span className="font-semibold text-foreground">{domain.domain}</span>?
                This will unbind all associated NGINX routing rules, SSL/TLS configurations,
                and rate limit policies immediately.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-3.5 bg-muted/30 border-t border-border flex items-center justify-end gap-2.5 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-border hover:bg-muted text-foreground font-medium transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm(domain);
              onClose();
            }}
            className="px-3.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white font-medium shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Domain
          </button>
        </div>
      </div>
    </div>
  );
}
