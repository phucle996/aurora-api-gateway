import React from 'react';
import { Link } from 'react-router-dom';

export function DashboardNodesSummary() {
  const nodes = [
    {
      name: 'edge-01',
      ip: '203.0.113.10',
      flag: '🇸🇬',
      region: 'SG',
      status: 'Online',
      rps: '3.2K',
      cpu: '28%',
      memory: '42%',
    },
    {
      name: 'edge-02',
      ip: '198.51.100.25',
      flag: '🇯🇵',
      region: 'JP',
      status: 'Online',
      rps: '2.1K',
      cpu: '16%',
      memory: '37%',
    },
    {
      name: 'edge-03',
      ip: '192.0.2.15',
      flag: '🇩🇪',
      region: 'DE',
      status: 'Online',
      rps: '1.8K',
      cpu: '24%',
      memory: '41%',
    },
    {
      name: 'edge-04',
      ip: '203.0.113.77',
      flag: '🇺🇸',
      region: 'US',
      status: 'Not Ready',
      rps: '0',
      cpu: '5%',
      memory: '12%',
    },
    {
      name: 'edge-05',
      ip: '10.0.1.21',
      flag: '🇻🇳',
      region: 'VN',
      status: 'Online',
      rps: '2.7K',
      cpu: '31%',
      memory: '48%',
    },
  ];

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
              <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" /> 10 Online
            </span>
            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-amber-500 inline-block rounded-full" /> 1 Not Ready
            </span>
            <span className="text-destructive flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-destructive inline-block rounded-full" /> 1 Offline
            </span>
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
              <th className="py-1.5 font-normal">Region</th>
              <th className="py-1.5 font-normal">Status</th>
              <th className="py-1.5 font-normal">RPS</th>
              <th className="py-1.5 font-normal">CPU</th>
              <th className="py-1.5 font-normal">Memory</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {nodes.map((node) => (
              <tr key={node.name} className="hover:bg-muted/50 transition-colors">
                <td className="py-2 text-foreground font-medium">{node.name}</td>
                <td className="py-2 text-muted-foreground">{node.ip}</td>
                <td className="py-2 text-muted-foreground">
                  <span className="mr-1">{node.flag}</span>
                  <span>{node.region}</span>
                </td>
                <td className="py-2">
                  {node.status === 'Online' ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" /> Online
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-amber-500 inline-block rounded-full" /> Not Ready
                    </span>
                  )}
                </td>
                <td className="py-2 text-foreground">{node.rps}</td>
                <td className="py-2 text-muted-foreground">{node.cpu}</td>
                <td className="py-2 text-muted-foreground">{node.memory}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
