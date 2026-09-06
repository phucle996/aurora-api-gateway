import React from 'react';
import { Calendar } from 'lucide-react';

interface DashboardHeaderProps {
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
}

export function DashboardHeader({ timeRange, onTimeRangeChange }: DashboardHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground tracking-tight">
          Dashboard
        </h1>
        <p className="text-xs text-muted-foreground mt-1 font-sans">
          Overview of your NGINX WAF cluster, traffic, and security events.
        </p>
      </div>

      <div className="flex items-center gap-2 font-sans">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-card border border-border text-xs font-sans text-foreground shadow-xs">
          <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
          <select
            value={timeRange}
            onChange={(e) => onTimeRangeChange(e.target.value)}
            className="bg-transparent text-foreground text-xs font-sans focus:outline-none cursor-pointer"
          >
            <option value="1h">Last 1 hour</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </div>
      </div>
    </div>
  );
}
