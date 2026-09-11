import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GitPullRequest,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Hash,
  Copy,
  Check,
  RefreshCw,
  Layers,
  ArrowDownToLine,
  ArrowRight,
} from 'lucide-react';
import type { NodeRecord } from '../../../lib/api/nodes';
import type { ClusterSpecInfo } from '../../../lib/api/spec';

interface DashboardSpecSyncPanelProps {
  nodes: NodeRecord[];
  clusterSpec: ClusterSpecInfo | null;
  onRefresh?: () => void;
}

export function DashboardSpecSyncPanel({
  nodes,
  clusterSpec,
  onRefresh,
}: DashboardSpecSyncPanelProps) {
  const [copied, setCopied] = useState(false);

  const fullHash = clusterSpec?.hash || 'None (Default Static Config)';
  const shortHash = clusterSpec?.hash
    ? `${clusterSpec.hash.slice(0, 12)}...${clusterSpec.hash.slice(-6)}`
    : 'No digest';

  const copyHash = () => {
    if (clusterSpec?.hash) {
      navigator.clipboard.writeText(clusterSpec.hash).catch(() => { });
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const inSyncCount = nodes.filter(
    (n) => n.sync === 'In Sync' || (n.ruleset && n.ruleset !== 'none')
  ).length;
  const driftCount = nodes.filter((n) => n.sync === 'Drift').length;
  const total = nodes.length;

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors font-sans h-full">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-violet-500/10 border border-violet-500/20 text-violet-600 dark:text-violet-400 rounded-xs">
              <GitPullRequest className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-sm font-semibold text-foreground">
                Declarative Spec Sync
              </span>
              <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded-xs bg-muted text-muted-foreground border border-border">
                Pull-by-Hash
              </span>
            </div>
          </div>
          <Link
            to="/nodes"
            className="text-xs text-primary hover:underline flex items-center gap-0.5"
          >
            <span>Nodes</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Cluster Target Release Box */}
        <div className="my-3 p-3 bg-muted/40 border border-border rounded-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-primary" />
              Target Cluster Release
            </span>
            <span className="text-xs font-mono font-bold text-foreground">
              {clusterSpec?.releaseId ? `Release #${clusterSpec.releaseId}` : 'Initial Baseline'}
            </span>
          </div>

          {/* SHA-256 Digest Box */}
          <div className="flex items-center justify-between gap-2 p-2 bg-background border border-border rounded-xs text-[11px] font-mono">
            <div className="flex items-center gap-1.5 text-muted-foreground truncate" title={fullHash}>
              <Hash className="w-3 h-3 shrink-0 text-violet-500" />
              <span className="text-foreground select-all">{shortHash}</span>
            </div>
            {clusterSpec?.hash && (
              <button
                type="button"
                onClick={copyHash}
                className="text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                title="Copy full SHA-256 digest"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>

          <div className="text-[10px] text-muted-foreground flex items-center gap-1">
            <ArrowDownToLine className="w-3 h-3 text-muted-foreground shrink-0" />
            <span>Dataplane agents periodically pull & verify SHA-256 digest via gRPC.</span>
          </div>
        </div>

        {/* Sync Convergence Summary */}
        <div className="space-y-2 mb-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Cluster Convergence</span>
            <span className="font-semibold tabular-nums text-foreground">
              {total > 0 ? `${inSyncCount} of ${total} nodes in sync` : 'Awaiting node connections'}
            </span>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden flex">
            <div
              className="bg-emerald-500 h-full transition-all duration-500"
              style={{ width: total > 0 ? `${(inSyncCount / total) * 100}%` : '100%' }}
              title="In Sync"
            />
            {driftCount > 0 && (
              <div
                className="bg-amber-500 h-full transition-all duration-500"
                style={{ width: `${(driftCount / total) * 100}%` }}
                title="Drifting"
              />
            )}
          </div>
        </div>

        {/* Per-Node Sync List */}
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
          {nodes.length === 0 ? (
            <div className="p-3 text-center text-xs text-muted-foreground bg-muted/20 rounded-sm">
              No data plane nodes registered yet.
            </div>
          ) : (
            nodes.map((node) => {
              const isSync = node.sync === 'In Sync' || (node.ruleset && node.ruleset !== 'none');
              return (
                <div
                  key={node.id}
                  className="flex items-center justify-between p-2 rounded-xs bg-muted/30 border border-border text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${isSync ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                    />
                    <span className="font-medium text-foreground truncate">
                      {node.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {node.ip}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {node.ruleset || 'rev-none'}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-medium ${isSync
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        }`}
                    >
                      {isSync ? (
                        <>
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          <span>In Sync</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>Drift</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-3 mt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>Polling interval: 15s</span>
        </span>
        <Link
          to="/nodes"
          className="text-primary hover:underline"
        >
          Manage Deployments
        </Link>
      </div>
    </div>
  );
}
