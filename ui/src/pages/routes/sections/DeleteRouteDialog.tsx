import React, { useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import type { RouteItem } from '../types';
import { routesApi } from '../../../lib/api/routes';

interface DeleteRouteDialogProps {
  route: RouteItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteRouteDialog({
  route,
  isOpen,
  onClose,
  onSuccess,
}: DeleteRouteDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !route) return null;

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await routesApi.delete(route.id);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete route');
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
            Delete Route
          </h3>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Are you sure you want to delete route{' '}
          <strong className="text-foreground">{route.name}</strong> (
          <code className="font-mono text-primary">{route.path}</code> on{' '}
          <code className="font-mono text-foreground">{route.host}</code>)? Traffic matching this path will no longer be forwarded to{' '}
          <strong className="text-foreground">{route.upstream_name}</strong>.
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
            {submitting ? 'Deleting...' : 'Delete Route'}
          </button>
        </div>
      </div>
    </div>
  );
}
