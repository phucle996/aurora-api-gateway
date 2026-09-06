import React from 'react';
import {
  Globe,
  ShieldAlert,
  Percent,
  FileCode,
  Server,
  Boxes,
  ArrowUpRight,
  ArrowRight,
} from 'lucide-react';

export function DashboardMetrics() {
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
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">12.4M</div>
          <div className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-3 h-3 inline" />
            <span>12%</span>
          </div>
        </div>
        {/* Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <path
              d="M0,20 Q15,15 30,18 T60,8 T80,14 T100,5"
              fill="none"
              stroke="var(--chart-allowed)"
              strokeWidth="2"
            />
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
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">342.1K</div>
          <div className="text-[10px] font-sans text-destructive flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-3 h-3 inline" />
            <span>28%</span>
          </div>
        </div>
        {/* Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <path
              d="M0,22 Q20,18 40,20 T70,12 T90,6 T100,4"
              fill="none"
              stroke="var(--chart-blocked)"
              strokeWidth="2"
            />
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
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">2.76%</div>
          <div className="text-[10px] font-sans text-primary flex items-center gap-0.5 mt-0.5">
            <ArrowUpRight className="w-3 h-3 inline" />
            <span>0.4%</span>
          </div>
        </div>
        {/* Sparkline */}
        <div className="h-6 w-full mt-2">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 25">
            <path
              d="M0,18 Q25,12 50,15 T75,10 T100,12"
              fill="none"
              stroke="var(--primary)"
              strokeWidth="2"
            />
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
          <div className="text-xl font-bold font-sans tabular-nums text-foreground">18</div>
          <div className="text-[10px] font-sans text-muted-foreground flex items-center gap-0.5 mt-0.5">
            <ArrowRight className="w-3 h-3 inline" />
            <span>0%</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-muted-foreground w-full" />
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
          <div className="text-xl font-bold font-sans tabular-nums text-emerald-600 dark:text-emerald-400">12 / 12</div>
          <div className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 mt-0.5">Online</div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 w-full" />
        </div>
      </div>

      {/* Card 6: Cluster Mode */}
      <div className="bg-card border border-border p-3.5 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
        <div>
          <div className="flex items-center justify-between text-muted-foreground mb-2">
            <span className="text-[11px] font-sans font-medium">Cluster Topology</span>
            <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 rounded-xs">
              <Boxes className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-sm font-bold font-sans text-foreground">HA NGINX Cluster</div>
          <div className="text-[10px] font-sans text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
            <span className="w-1.5 h-1.5 bg-emerald-500 inline-block rounded-full" />
            <span>LB: aurora-lb (:8090)</span>
          </div>
        </div>
        <div className="h-1.5 w-full bg-muted mt-3 rounded-full overflow-hidden">
          <div className="h-full bg-indigo-500 w-full" />
        </div>
      </div>
    </div>
  );
}
