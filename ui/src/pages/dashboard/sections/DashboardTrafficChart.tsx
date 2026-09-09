import React, { useState } from 'react';

export function DashboardTrafficChart() {
  const [range, setRange] = useState('Last 24 hours');

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-border">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-foreground font-sans">
            Request Traffic
          </span>
          <div className="flex items-center gap-3 text-xs font-sans">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-[var(--chart-allowed)] inline-block rounded-xs" />
              <span className="text-muted-foreground">Allowed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-[var(--chart-blocked)] inline-block rounded-xs" />
              <span className="text-muted-foreground">Blocked</span>
            </div>
          </div>
        </div>

        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="bg-background border border-input px-2 py-1 text-foreground text-xs font-sans focus:outline-none focus:border-primary rounded-sm cursor-pointer transition-colors"
        >
          <option value="Last 24 hours">Last 24 hours</option>
          <option value="Last 7 days">Last 7 days</option>
          <option value="Last 30 days">Last 30 days</option>
        </select>
      </div>

      {/* Chart SVG */}
      <div className="relative pt-6 pb-2">
        <div className="flex items-center">
          {/* Y Axis */}
          <div className="flex flex-col justify-between h-44 text-[10px] font-sans tabular-nums text-muted-foreground pr-2 select-none">
            <span>100</span>
            <span>75</span>
            <span>50</span>
            <span>25</span>
            <span>0</span>
          </div>

          {/* SVG Canvas */}
          <div className="flex-1 h-44 relative flex items-center justify-center">
            <svg className="w-full h-full" viewBox="0 0 500 150" preserveAspectRatio="none">
              {/* Grid Lines */}
              <line x1="0" y1="0" x2="500" y2="0" stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1="37.5" x2="500" y2="37.5" stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1="75" x2="500" y2="75" stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1="112.5" x2="500" y2="112.5" stroke="var(--border)" strokeDasharray="3 3" />
              <line x1="0" y1="150" x2="500" y2="150" stroke="var(--border)" />

              {/* Baseline at 0 */}
              <line x1="0" y1="149" x2="500" y2="149" stroke="var(--chart-allowed)" strokeWidth="2" strokeDasharray="4 4" />
            </svg>

            {/* Empty State Overlay */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
              <span className="text-xs font-semibold text-foreground font-sans">
                Awaiting Traffic Data
              </span>
              <span className="text-[11px] text-muted-foreground font-sans mt-0.5 max-w-sm">
                Real-time traffic throughput and block ratios will appear here as HTTP requests are processed.
              </span>
            </div>
          </div>
        </div>

        {/* X Axis */}
        <div className="flex justify-between pl-8 pt-2 text-[10px] font-sans tabular-nums text-muted-foreground">
          <span>00:00</span>
          <span>04:00</span>
          <span>08:00</span>
          <span>12:00</span>
          <span>16:00</span>
          <span>20:00</span>
        </div>
      </div>
    </div>
  );
}

