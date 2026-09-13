import React from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  Zap,
  CheckCircle2,
  GitBranch,
  Shield,
  Layers,
  ArrowRight,
  Radio,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import type { ClusterSpecInfo } from '../../../lib/api/spec';
import type { SystemInfo } from '../../../lib/api/system';

interface DashboardNodesSummaryProps {
  systemInfo?: SystemInfo | null;
  clusterSpec?: ClusterSpecInfo | null;
  onRefresh?: () => void;
}

export function DashboardNodesSummary({
  systemInfo,
  clusterSpec,
  onRefresh,
}: DashboardNodesSummaryProps) {
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
                Stateless Dataplane Fleet Architecture
              </span>
              <div className="flex items-center gap-2 text-[11px] mt-0.5">
                <span className="text-muted-foreground">
                  Decoupled Topology:{' '}
                  <strong className="text-foreground font-medium">Zero Node Registration</strong> •{' '}
                  <strong className="text-foreground font-medium">Agent Pull (gRPC)</strong> •{' '}
                  <strong className="text-foreground font-medium">Atomic Reload</strong>
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono px-2 py-0.5 rounded-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Stateless Mode Active
            </span>
          </div>
        </div>

        {/* 3-Step Pull Synchronization Architecture */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 my-4">
          <div className="p-3 bg-muted/40 border border-border rounded-sm space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" />
                1. Authority Release
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">Control Plane</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Mutations compile into an atomic, deterministic JSON spec and generate a SHA-256 release digest.
            </p>
          </div>

          <div className="p-3 bg-muted/40 border border-border rounded-sm space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-violet-500" />
                2. gRPC Agent Pull
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">Port :9090</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Stateless edge agents continuously query <code className="text-foreground font-mono">SyncSpec</code> over HTTP/2. Zero database node registrations required.
            </p>
          </div>

          <div className="p-3 bg-muted/40 border border-border rounded-sm space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                3. Zero-Downtime Reload
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">NGINX Master</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              On hash mismatch, edge validates NGINX syntax, updates active routing snapshots, and reloads gracefully.
            </p>
          </div>
        </div>

        {/* Technical Highlights & Characteristics */}
        <div className="space-y-2 text-xs border-t border-border pt-3">
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Horizontal Elastic Scaling
            </span>
            <span className="text-foreground font-medium">
              Scale out to 100+ replicas on Kubernetes / Docker with no database bottleneck
            </span>
          </div>

          <div className="flex items-center justify-between py-1 border-t border-border/50">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Data Plane Ingress Listeners
            </span>
            <span className="text-foreground font-mono">
              HTTP: 80 • HTTPS: 443 • Metrics: 9145
            </span>
          </div>

          <div className="flex items-center justify-between py-1 border-t border-border/50">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              Zero-State Worker Boot
            </span>
            <span className="text-foreground font-medium">
              Instances boot without NODE_ID, pulling configuration instantly upon startup
            </span>
          </div>
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="pt-3 mt-3 border-t border-border flex flex-wrap items-center justify-between text-xs text-muted-foreground">
        <span>Stateless appliance fleet managed declaratively via Control Plane</span>
        <div className="flex items-center gap-3">
          <Link to="/routes" className="text-primary hover:underline flex items-center gap-1">
            <span>Manage Routes</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
          <Link to="/extensions" className="text-primary hover:underline flex items-center gap-1">
            <span>Extensions</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
