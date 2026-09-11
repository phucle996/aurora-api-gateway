import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  HeartPulse,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  ExternalLink,
  Trash2,
  Clock,
  Radio,
} from 'lucide-react';
import { nodesApi, type NodeRecord } from '../../../lib/api/nodes';
import type { ClusterSpecInfo } from '../../../lib/api/spec';

interface DashboardNodesSummaryProps {
  nodes: NodeRecord[];
  clusterSpec?: ClusterSpecInfo | null;
  onRefresh?: () => void;
}

function formatAge(runtimeStartedAt?: number, createdAtStr?: string): string {
  const now = Date.now();
  let ms = 0;
  if (runtimeStartedAt && runtimeStartedAt > 0) {
    ms = runtimeStartedAt * 1000;
  } else if (createdAtStr) {
    const parsed = Date.parse(createdAtStr);
    if (!isNaN(parsed)) ms = parsed;
  }

  if (ms <= 0) return 'Just now';
  const diffSec = Math.max(0, Math.floor((now - ms) / 1000));
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${diffSec}s`;
}

export function DashboardNodesSummary({
  nodes,
  clusterSpec,
  onRefresh,
}: DashboardNodesSummaryProps) {
  const [now, setNow] = useState(Date.now());
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const onlineCount = nodes.filter((n) => n.status === 'Ready').length;
  const totalCount = nodes.length;

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Deregister / Remove stale node "${name}" from registry?`)) {
      return;
    }
    setDeletingId(id);
    try {
      await nodesApi.delete(id);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert(`Failed to delete node: ${err.message || 'Unknown error'}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors font-sans h-full">
      <div>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
              <Server className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-sm font-semibold text-foreground">
                Data Plane Fleet Lifecycle Matrix
              </span>
              <div className="flex items-center gap-2 text-[11px] mt-0.5">
                <span className="text-muted-foreground">
                  3-Pillar Validation:{' '}
                  <strong className="text-foreground font-medium">Liveness</strong> •{' '}
                  <strong className="text-foreground font-medium">Readiness</strong> •{' '}
                  <strong className="text-foreground font-medium">Spec Sync</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded-xs border border-border">
              {onlineCount}/{totalCount} Active
            </span>
            <Link
              to="/nodes"
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <span>Manage Fleet</span>
              <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Fleet Table */}
        <div className="py-2 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border text-[11px]">
                <th className="py-2.5 font-medium">Pod / Instance</th>
                <th className="py-2.5 font-medium">Age</th>
                <th className="py-2.5 font-medium">1. Liveness (Heartbeat)</th>
                <th className="py-2.5 font-medium">2. Readiness (Traffic)</th>
                <th className="py-2.5 font-medium">3. Spec Sync (Digest)</th>
                <th className="py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {nodes.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground text-xs font-sans"
                  >
                    No data plane instances registered. Start an agent or connect a container.
                  </td>
                </tr>
              ) : (
                nodes.map((node) => {
                  // Liveness Calculation
                  const hbMs = node.lastHeartbeatTimestamp || 0;
                  const secSinceHb = hbMs > 0 ? Math.floor((now - hbMs) / 1000) : 999;
                  const isAlive = secSinceHb < 20;

                  // Readiness
                  const isReady = node.status === 'Ready';
                  const isDraining = node.status === 'Draining';

                  // Spec Sync
                  const isSync =
                    node.sync === 'In Sync' ||
                    (node.ruleset && node.ruleset !== 'none');
                  const isSyncing = node.sync === 'Syncing';

                  // Short hash
                  const shortDigest = node.ruleset || 'r-init';

                  return (
                    <tr
                      key={node.id}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      {/* 1. Pod / Instance */}
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-1.5">
                          <Link
                            to={`/nodes?id=${encodeURIComponent(node.id)}`}
                            className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                          >
                            <span>{node.name}</span>
                            <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                          </Link>
                          {node.hostname && node.hostname !== node.name && (
                            <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1 rounded-xs">
                              {node.hostname}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {node.ip} • v{node.version || '0.4.1'}
                        </div>
                      </td>

                      {/* Age */}
                      <td className="py-3 pr-3 text-muted-foreground font-mono text-[11px]">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                          {formatAge(node.runtimeStartedAt, node.created_at)}
                        </span>
                      </td>

                      {/* 2. Liveness */}
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[10px] font-medium ${
                              isAlive
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                : 'bg-destructive/10 text-destructive border border-destructive/20'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isAlive
                                  ? 'bg-emerald-500 animate-pulse'
                                  : 'bg-destructive'
                              }`}
                            />
                            {isAlive ? 'Alive' : 'Dead'}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {secSinceHb < 60
                              ? `${secSinceHb}s ago`
                              : `${Math.floor(secSinceHb / 60)}m ago`}
                          </span>
                        </div>
                      </td>

                      {/* 3. Readiness */}
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[10px] font-medium ${
                            isReady
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              : isDraining
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              : 'bg-destructive/10 text-destructive border border-destructive/20'
                          }`}
                        >
                          {isReady ? (
                            <CheckCircle2 className="w-2.5 h-2.5" />
                          ) : (
                            <AlertTriangle className="w-2.5 h-2.5" />
                          )}
                          {node.status}
                        </span>
                      </td>

                      {/* 4. Spec Sync */}
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs text-[10px] font-medium ${
                              isSync
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                : isSyncing
                                ? 'bg-primary/10 text-primary border border-primary/20'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {isSync ? (
                              <CheckCircle2 className="w-2.5 h-2.5" />
                            ) : isSyncing ? (
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                            ) : (
                              <AlertTriangle className="w-2.5 h-2.5" />
                            )}
                            {node.sync || (isSync ? 'In Sync' : 'Drift')}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1 py-0.5 rounded-xs border border-border">
                            {shortDigest}
                          </span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            to={`/nodes?id=${encodeURIComponent(node.id)}`}
                            className="text-xs text-primary hover:underline"
                            title="Inspect node config and sync history"
                          >
                            Config
                          </Link>
                          {!isAlive && (
                            <button
                              type="button"
                              onClick={() => handleDelete(node.id, node.name)}
                              disabled={deletingId === node.id}
                              className="text-muted-foreground hover:text-destructive p-1 rounded-xs transition-colors cursor-pointer disabled:opacity-50"
                              title="Prune dead node from registry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Notice */}
      <div className="pt-2.5 border-t border-border flex flex-wrap items-center justify-between text-[11px] text-muted-foreground gap-2">
        <span>
          Auto-pruning active: pods without heartbeats for &gt;10 minutes are automatically pruned.
        </span>
        <div className="flex items-center gap-2">
          <Link to="/nodes" className="text-primary hover:underline">
            Rolling Reload All Nodes
          </Link>
        </div>
      </div>
    </div>
  );
}
