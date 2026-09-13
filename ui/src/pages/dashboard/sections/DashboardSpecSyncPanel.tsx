import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  GitPullRequest,
  CheckCircle2,
  Clock,
  Hash,
  Copy,
  Check,
  Layers,
  Radio,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import type { ClusterSpecInfo } from '../../../lib/api/spec';

interface DashboardSpecSyncPanelProps {
  clusterSpec: ClusterSpecInfo | null;
  onRefresh?: () => void;
}

export function DashboardSpecSyncPanel({
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
      navigator.clipboard.writeText(clusterSpec.hash).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

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
          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Ready
          </span>
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
        </div>

        {/* Sync Pipeline Status & Properties */}
        <div className="space-y-2.5 text-xs my-3">
          <div className="p-2.5 bg-card border border-border rounded-sm space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Radio className="w-3 h-3 text-violet-500" />
                Delivery Channel
              </span>
              <span className="font-mono text-foreground font-semibold">gRPC HTTP/2 (:9090)</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3 text-emerald-500" />
                Convergence Method
              </span>
              <span className="text-foreground font-medium">Atomic Checksum Poll</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-primary" />
                Sync Interval
              </span>
              <span className="font-mono text-foreground">3s continuous poll</span>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground leading-relaxed px-1">
            Data plane replicas pull active spec without central state coordination. Any configuration drift automatically triggers an in-memory test and atomic NGINX reload.
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-3 mt-3 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>Continuous Agent Sync</span>
        </span>
        <Link
          to="/routes"
          className="text-primary hover:underline flex items-center gap-0.5"
        >
          <span>View Ingress Routes</span>
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
