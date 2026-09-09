import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { nodesApi, type NodeRecord } from '../../../lib/api/nodes';

export function DashboardNodesSummary() {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);

  useEffect(() => {
    nodesApi.list().then(setNodes).catch(() => {});
  }, []);

  const onlineCount = nodes.filter((n) => n.status === 'Ready').length;
  const notReadyCount = nodes.filter((n) => n.status !== 'Ready').length;

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-foreground font-sans">
            NGINX Nodes
          </span>
          <div className="flex items-center gap-2 text-[11px] font-sans">
            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" /> {onlineCount} Online
            </span>
            {notReadyCount > 0 && (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-amber-500 inline-block rounded-full" /> {notReadyCount} Not Ready
              </span>
            )}
          </div>
        </div>

        <Link
          to="/nodes"
          className="text-xs font-sans text-primary hover:underline transition-colors"
        >
          View All
        </Link>
      </div>

      {/* Mini Table */}
      <div className="py-2 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs font-sans">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="py-1.5 font-normal">Name</th>
              <th className="py-1.5 font-normal">IP Address</th>
              <th className="py-1.5 font-normal">Hostname</th>
              <th className="py-1.5 font-normal">Status</th>
              <th className="py-1.5 font-normal">RPS</th>
              <th className="py-1.5 font-normal">CPU</th>
              <th className="py-1.5 font-normal">Memory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-muted-foreground text-xs font-sans">
                  No data plane nodes registered yet.
                </td>
              </tr>
            ) : (
              nodes.map((node) => (
                <tr key={node.id} className="hover:bg-muted/50 transition-colors">
                  <td className="py-2 text-foreground font-medium">{node.name}</td>
                  <td className="py-2 text-muted-foreground font-mono">{node.ip}</td>
                  <td className="py-2 text-muted-foreground">{node.hostname || '—'}</td>
                  <td className="py-2">
                    {node.status === 'Ready' ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" /> Ready
                      </span>
                    ) : (
                      <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-amber-500 inline-block rounded-full" /> {node.status}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-foreground">{node.requestsPerSecond || '—'}</td>
                  <td className="py-2 text-muted-foreground">{node.cpuUsage ? `${node.cpuUsage}%` : '—'}</td>
                  <td className="py-2 text-muted-foreground">{node.memoryUsage ? `${node.memoryUsage}%` : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

