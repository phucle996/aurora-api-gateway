import React from 'react';
import { Link } from 'react-router-dom';
import {
  Server,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import type { NodeRecord } from '../../../lib/api/nodes';

interface DashboardNodesSummaryProps {
  nodes: NodeRecord[];
}

export function DashboardNodesSummary({ nodes }: DashboardNodesSummaryProps) {
  const onlineCount = nodes.filter((n) => n.status === 'Ready').length;
  const notReadyCount = nodes.filter((n) => n.status !== 'Ready').length;
  const driftCount = nodes.filter((n) => n.sync === 'Drift').length;

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors font-sans h-full">
      <div>
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xs">
              <Server className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-sm font-semibold text-foreground">
                Data Plane Nodes Matrix
              </span>
              <div className="flex items-center gap-2 text-[11px] mt-0.5">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" />{' '}
                  {onlineCount} Online
                </span>
                {notReadyCount > 0 && (
                  <span className="text-destructive flex items-center gap-1 font-medium">
                    <span className="w-1.5 h-1.5 bg-destructive inline-block rounded-full" />{' '}
                    {notReadyCount} Degraded
                  </span>
                )}
                {driftCount > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                    <span className="w-1.5 h-1.5 bg-amber-500 inline-block rounded-full" />{' '}
                    {driftCount} Drift
                  </span>
                )}
              </div>
            </div>
          </div>

          <Link
            to="/nodes"
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <span>All Nodes</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Nodes Table */}
        <div className="py-2 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border text-[11px]">
                <th className="py-2 font-medium">Node</th>
                <th className="py-2 font-medium">Liveness</th>
                <th className="py-2 font-medium">Spec State</th>
                <th className="py-2 font-medium text-right">RPS</th>
                <th className="py-2 font-medium text-right">Conns</th>
                <th className="py-2 font-medium text-right">CPU</th>
                <th className="py-2 font-medium text-right">RAM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {nodes.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground text-xs font-sans"
                  >
                    No data plane nodes connected. Check cluster enrollment or agent config.
                  </td>
                </tr>
              ) : (
                nodes.map((node) => {
                  const isReady = node.status === 'Ready';
                  const isSync =
                    node.sync === 'In Sync' ||
                    (node.ruleset && node.ruleset !== 'none');
                  const isSyncing = node.sync === 'Syncing';

                  return (
                    <tr
                      key={node.id}
                      className="hover:bg-muted/40 transition-colors group"
                    >
                      {/* Name & IP */}
                      <td className="py-2.5 pr-2">
                        <Link
                          to={`/nodes?id=${encodeURIComponent(node.id)}`}
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1"
                        >
                          <span>{node.name}</span>
                          <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                        </Link>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {node.ip}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-2.5 pr-2">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-medium ${
                            isReady
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                              : 'bg-destructive/10 text-destructive border border-destructive/20'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isReady ? 'bg-emerald-500' : 'bg-destructive'
                            }`}
                          />
                          {node.status}
                        </span>
                      </td>

                      {/* Sync State */}
                      <td className="py-2.5 pr-2">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-medium ${
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
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {node.ruleset || 'none'}
                          </span>
                        </div>
                      </td>

                      {/* RPS */}
                      <td className="py-2.5 text-right font-medium tabular-nums text-foreground">
                        {node.requestsPerSecond || '0.0'}
                      </td>

                      {/* Active Connections */}
                      <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                        {node.activeConnections || '0'}
                      </td>

                      {/* CPU */}
                      <td className="py-2.5 text-right tabular-nums">
                        <span
                          className={`font-medium ${
                            (node.cpuUsage || 0) > 80
                              ? 'text-destructive font-bold'
                              : (node.cpuUsage || 0) > 50
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-foreground'
                          }`}
                        >
                          {node.cpuUsage ? `${node.cpuUsage}%` : '0%'}
                        </span>
                      </td>

                      {/* RAM */}
                      <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                        {node.memoryUsage ? `${node.memoryUsage}%` : '0%'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Click any node to view real-time process logs and raw config</span>
        <Link to="/nodes" className="text-primary hover:underline">
          Cluster Rolling Reload
        </Link>
      </div>
    </div>
  );
}
