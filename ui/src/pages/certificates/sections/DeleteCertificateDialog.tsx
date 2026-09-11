import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { CertificateItem } from '../types';
import { certificatesApi } from '../../../lib/api/certificates';

interface DeleteCertificateDialogProps {
  cert: CertificateItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteCertificateDialog({
  cert,
  isOpen,
  onClose,
  onSuccess,
}: DeleteCertificateDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !cert) return null;

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await certificatesApi.delete(cert.id);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete certificate');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-card border border-border/80 rounded-2xl shadow-2xl p-6 font-sans">
        <div className="flex items-center gap-3 text-destructive mb-3">
          <div className="p-2.5 rounded-xl bg-destructive/10">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            Delete SSL Certificate
          </h3>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Are you sure you want to delete certificate{' '}
          <strong className="text-foreground">{cert.name}</strong> (
          <code className="font-mono text-primary">{cert.id}</code>)? Domains bound to this certificate will fail HTTPS handshakes unless an alternate matching certificate exists.
        </p>

        {error && (
          <div className="mt-3 p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-destructive-foreground bg-destructive hover:bg-destructive/90 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {submitting ? 'Deleting...' : 'Delete Certificate'}
          </button>
        </div>
      </div>
    </div>
  );
}
