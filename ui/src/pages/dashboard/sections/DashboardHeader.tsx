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
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
          Dashboard
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-sans">
          Overview of your NGINX WAF cluster, traffic, and security events.
        </p>
      </div>

      <div className="flex items-center gap-2 font-sans">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] text-xs font-sans text-slate-700 dark:text-slate-300 shadow-xs">
          <Calendar className="w-3.5 h-3.5 text-slate-400 dark:text-slate-400" />
          <select
            value={timeRange}
            onChange={(e) => onTimeRangeChange(e.target.value)}
            className="bg-transparent text-slate-800 dark:text-slate-200 text-xs font-sans focus:outline-none cursor-pointer"
          >
            <option value="1h" className="bg-white dark:bg-[#0B1320] text-slate-800 dark:text-slate-200">Last 1 hour</option>
            <option value="24h" className="bg-white dark:bg-[#0B1320] text-slate-800 dark:text-slate-200">Last 24 hours</option>
            <option value="7d" className="bg-white dark:bg-[#0B1320] text-slate-800 dark:text-slate-200">Last 7 days</option>
            <option value="30d" className="bg-white dark:bg-[#0B1320] text-slate-800 dark:text-slate-200">Last 30 days</option>
          </select>
        </div>
      </div>
    </div>
  );
}
