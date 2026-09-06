import React, { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, AlertTriangle, X, Loader2 } from 'lucide-react';
import { policiesApi, type SavedPolicy, type ClusterPolicies } from '../../../lib/api/policies';

export function PolicyDetail({
  policy,
  cluster,
  onChanged,
  onClose,
}: {
  policy: SavedPolicy;
  cluster: ClusterPolicies;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<'publish' | 'disable' | null>(null);
  const retry = useRef<{ operation: string; key: string } | null>(null);

  // Close dialog on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        setConfirmDialog(null);
      }
    };
    if (confirmDialog) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmDialog, busy]);

  async function run(operation: string) {
    if (busy) return;
    const signature = `${operation}:${policy.version}:${cluster.release_id}`;
    if (retry.current?.operation !== signature) {
      retry.current = { operation: signature, key: crypto.randomUUID() };
    }
    const key = retry.current.key;
    setBusy(true);
    setError('');
    try {
      await policiesApi.publish(
        policy.id,
        policy.version,
        cluster.release_id,
        operation === 'disable',
        key,
        false
      );
      retry.current = null;
      setConfirmDialog(null);
      await onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="xl:col-span-5 bg-card border border-border p-4 space-y-4 shadow-xs rounded-sm font-sans text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-border pb-2">
        <h2 className="font-bold text-sm text-slate-900 dark:text-white font-sans">
          {policy.document.name}
        </h2>
        <button
          aria-label="Close policy details"
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-600 dark:text-slate-400">
        {policy.document.description || 'No description provided.'}
      </p>

      {/* Revisions & Scope Info Box */}
      <div className="p-2.5 bg-muted/30 border border-border text-xs font-sans space-y-1 rounded-sm">
        <div>
          Draft revision:{' '}
          <span className="font-semibold text-slate-900 dark:text-white font-mono">
            v{policy.version}
          </span>{' '}
          · Published:{' '}
          <span className="font-semibold text-slate-900 dark:text-white font-mono">
            {policy.published_version ? `v${policy.published_version}` : 'none'}
          </span>
        </div>
        <div>
          Scope:{' '}
          <span className="text-cyan-700 dark:text-cyan-400 font-medium font-mono">
            {policy.document.host === '*' ? 'All Domains (*)' : policy.document.host}
          </span>{' '}
          · Mode: <span className="font-bold">{policy.document.mode}</span> · Priority:{' '}
          <span className="font-mono tabular-nums">{policy.document.priority}</span>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        Lowest priority number wins; ties use policy ID. First matching domain scope owns the request. Endpoint and path conditions are evaluated per rule.
      </p>

      {/* Rules Table */}
      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Rules ({policy.document.rules.length})
        </div>
        <div className="border border-border rounded-sm overflow-hidden text-xs">
          <table className="w-full text-left font-sans">
            <thead className="bg-muted/40 text-muted-foreground border-b border-border">
              <tr>
                <th className="py-2 px-2.5 font-medium">Rule</th>
                <th className="py-2 px-2 font-medium w-14 text-center">Ver</th>
                <th className="py-2 px-2.5 font-medium">Group</th>
                <th className="py-2 px-2.5 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {policy.document.rules.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-4 text-center text-slate-400 dark:text-slate-500 italic"
                  >
                    No rules attached
                  </td>
                </tr>
              ) : (
                policy.document.rules.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-muted/40 transition-colors"
                  >
                    <td className="py-2 px-2.5 font-medium text-slate-900 dark:text-white">
                      <div>{r.name}</div>
                      {(!r.runtime_ready || !r.enabled) && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                          Not publishable
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center text-slate-500 dark:text-slate-400">
                      v{r.version}
                    </td>
                    <td className="py-2 px-2.5 text-slate-600 dark:text-slate-300">
                      <span className="px-1.5 py-0.5 rounded-xs bg-muted text-muted-foreground text-[11px]">
                        {r.group || 'default'}
                      </span>
                    </td>
                    <td className="py-2 px-2.5 text-right font-semibold">
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded-xs text-[11px] uppercase ${
                          r.action === 'block'
                            ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50'
                            : r.action === 'allow'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50'
                            : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-900/50'
                        }`}
                      >
                        {r.action}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <p
          role="alert"
          className="p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs rounded-sm"
        >
          {error}
        </p>
      )}

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 text-xs font-sans pt-1">
        <Link
          to={`/policies/create?edit=${policy.id}`}
          className="p-2 text-center bg-muted hover:bg-accent border border-border text-foreground rounded-sm cursor-pointer transition-colors"
        >
          Edit draft
        </Link>
        <Link
          to={`/policies/create?clone=${policy.id}`}
          className="p-2 text-center bg-muted hover:bg-accent border border-border text-foreground rounded-sm cursor-pointer transition-colors"
        >
          Clone policy
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmDialog('publish')}
          className="p-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-sm col-span-2 cursor-pointer disabled:opacity-40 transition-colors shadow-xs"
        >
          Publish policy
        </button>
        <button
          type="button"
          disabled={busy || policy.published_version === null}
          onClick={() => setConfirmDialog('disable')}
          className="p-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 dark:hover:bg-rose-950 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 rounded-sm col-span-2 cursor-pointer disabled:opacity-40 transition-colors"
        >
          Disable policy
        </button>
      </div>

      {/* Custom Publish Confirmation Dialog */}
      {confirmDialog === 'publish' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 font-sans"
          onClick={() => !busy && setConfirmDialog(null)}
        >
          <div
            className="bg-card border border-border w-full max-w-md rounded-sm shadow-2xl overflow-hidden text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-sm bg-primary/10 border border-primary/20 text-primary">
                  <Rocket className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Publish Policy to Cluster
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Deploy policy revision to all active nodes
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDialog(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dialog Body */}
            <div className="p-5 space-y-3.5">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs">
                Are you sure you want to publish <strong className="text-slate-900 dark:text-white font-semibold">{policy.document.name}</strong> to the entire cluster?
              </p>

              <div className="p-3 bg-muted/30 border border-border rounded-sm space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Draft Revision:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">v{policy.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Scope:</span>
                  <span className="text-cyan-700 dark:text-cyan-400 font-medium">
                    {policy.document.host === '*' ? 'All Domains (*)' : policy.document.host}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Mode / Priority:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {policy.document.mode} / {policy.document.priority}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Rules Attached:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {policy.document.rules.length} rule(s)
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                This action compiles rule snapshots and broadcasts the updated configuration to all connected WAF nodes immediately.
              </p>
            </div>

            {/* Dialog Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-muted/40">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDialog(null)}
                className="px-3.5 py-1.5 bg-muted hover:bg-accent border border-border text-foreground rounded-sm cursor-pointer disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('publish')}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-sm cursor-pointer disabled:opacity-50 shadow-xs transition-colors"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Publishing...</span>
                  </>
                ) : (
                  <>
                    <Rocket className="w-3.5 h-3.5" />
                    <span>Confirm & Publish</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Disable Confirmation Dialog */}
      {confirmDialog === 'disable' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 font-sans"
          onClick={() => !busy && setConfirmDialog(null)}
        >
          <div
            className="bg-card border border-border w-full max-w-md rounded-sm shadow-2xl overflow-hidden text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Dialog Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/40">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-sm bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Disable Policy
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Deactivate policy across the cluster
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDialog(null)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dialog Body */}
            <div className="p-5 space-y-3.5">
              <p className="text-slate-600 dark:text-slate-300 leading-relaxed text-xs">
                Are you sure you want to remove <strong className="text-slate-900 dark:text-white font-semibold">{policy.document.name}</strong> from the next cluster release?
              </p>
              <p className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 p-2.5 rounded-sm">
                Incoming traffic will no longer be filtered or matched by this policy once deactivated.
              </p>
            </div>

            {/* Dialog Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border bg-muted/40">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmDialog(null)}
                className="px-3.5 py-1.5 bg-muted hover:bg-accent border border-border text-foreground rounded-sm cursor-pointer disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run('disable')}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-semibold rounded-sm cursor-pointer disabled:opacity-50 shadow-xs transition-colors"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Disabling...</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Confirm & Disable</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default PolicyDetail;
