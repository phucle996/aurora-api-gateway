import React, { useEffect, useState } from 'react';
import {
  Globe,
  ShieldAlert,
  Percent,
  FileCode,
  Server,
  Boxes,
} from 'lucide-react';
import { nodesApi } from '../../../lib/api/nodes';
import { systemApi } from '../../../lib/api/system';
import { getAuthToken } from '../../../lib/fetcher';

export function DashboardMetrics() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [rulesStats, setRulesStats] = useState<any>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);

  useEffect(() => {
    nodesApi.list().then(setNodes).catch(() => {});
    systemApi.getInfo().then(setSystemInfo).catch(() => {});
    const token = getAuthToken();
    fetch('/api/v1/rules/stats', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setRulesStats(data); })
      .catch(() => {});
  }, []);

  const totalNodes = nodes.length;
  const readyNodes = nodes.filter((n) => n.status === 'Ready').length;
  const activeRules = rulesStats?.enabled ?? rulesStats?.total ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 font-sans">
      {/* Card 1: Total Requests */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-sans font-medium">Total Requests</span>
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
              <Globe className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">0</div>
          <div className="text-[10px] font-sans text-muted-foreground flex items-center gap-0.5 mt-0.5">
            <span>No incoming traffic yet</span>
          </div>
        </div>
        {/* Flat Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <line x1="0" y1="20" x2="100" y2="20" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
        </div>
      </div>

      {/* Card 2: Blocked Requests */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-sans font-medium">Blocked Requests</span>
            <div className="p-1.5 bg-destructive/10 border border-destructive/20 text-destructive rounded-xs">
              <ShieldAlert className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">0</div>
          <div className="text-[10px] font-sans text-muted-foreground flex items-center gap-0.5 mt-0.5">
            <span>No blocks recorded</span>
          </div>
        </div>
        {/* Flat Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <line x1="0" y1="20" x2="100" y2="20" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
        </div>
      </div>

      {/* Card 3: Block Rate */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-sans font-medium">Block Rate</span>
            <div className="p-1.5 bg-primary/10 border border-primary/20 text-primary rounded-xs">
              <Percent className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">0.0%</div>
          <div className="text-[10px] font-sans text-muted-foreground flex items-center gap-0.5 mt-0.5">
            <span>Baseline</span>
          </div>
        </div>
        {/* Flat Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <line x1="0" y1="20" x2="100" y2="20" stroke="var(--border)" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
        </div>
      </div>

      {/* Card 4: Active Policies */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-sans font-medium">Active Policies</span>
            <div className="p-1.5 bg-muted border border-border text-muted-foreground rounded-xs">
              <FileCode className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">{activeRules}</div>
          <div className="text-[10px] font-sans text-muted-foreground flex items-center gap-0.5 mt-0.5">
            <span>Configured</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-primary" style={{ width: activeRules > 0 ? '100%' : '0%' }} />
        </div>
      </div>

      {/* Card 5: NGINX Nodes */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-sans font-medium">NGINX Nodes</span>
            <div className="p-1.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xs">
              <Server className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className={`text-xl font-bold font-sans tabular-nums ${readyNodes > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
            {readyNodes} / {totalNodes}
          </div>
          <div className="text-[10px] font-sans text-muted-foreground mt-0.5">
            {readyNodes > 0 ? 'Online' : totalNodes === 0 ? 'No Nodes Joined' : 'Awaiting Heartbeat'}
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500"
            style={{ width: totalNodes > 0 ? `${(readyNodes / totalNodes) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Card 6: Cluster Topology */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-sans font-medium">Cluster Topology</span>
            <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xs">
              <Boxes className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm font-bold font-sans text-foreground">
            {totalNodes > 1 ? 'Cluster Mode' : 'Standalone / Local'}
          </div>
          <div className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" />
            <span>{systemInfo?.product || 'Aurora WAF'} ({systemInfo?.version || '0.4.2'})</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 w-full" />
        </div>
      </div>
    </div>
  );
}

