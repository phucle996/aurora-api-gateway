import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

export function DashboardAttackTypes() {
  const [range, setRange] = useState('Last 24 hours');

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground font-sans">
          Top Attack Types
        </span>
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

      {/* Body: Clean Empty State */}
      <div className="flex flex-col items-center justify-center py-10 text-center flex-1">
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-full mb-3">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="text-xs font-semibold text-foreground font-sans">
          No Threats Detected
        </div>
        <div className="text-[11px] text-muted-foreground font-sans mt-1 max-w-[200px]">
          All inspected requests conform to configured security baselines.
        </div>
      </div>
    </div>
  );
}

