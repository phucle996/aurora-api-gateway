import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function DashboardTrafficChart() {
  const [range, setRange] = useState('Last 24 hours');

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col justify-between">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#152030]">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-white font-mono">
            Request Traffic
          </span>
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-blue-500 inline-block" />
              <span className="text-slate-300">Allowed</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-rose-500 inline-block" />
              <span className="text-slate-300">Blocked</span>
            </div>
          </div>
        </div>

        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="bg-[#0E1726] border border-[#1C293D] px-2 py-1 text-slate-300 text-xs font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
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
          <div className="flex flex-col justify-between h-44 text-[10px] font-mono text-slate-500 pr-2 select-none">
            <span>400K</span>
            <span>300K</span>
            <span>200K</span>
            <span>100K</span>
            <span>0</span>
          </div>

          {/* SVG Canvas */}
          <div className="flex-1 h-44 relative">
            <svg className="w-full h-full" viewBox="0 0 500 150" preserveAspectRatio="none">
              <defs>
                <linearGradient id="allowedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="blockedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ef4444" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              <line x1="0" y1="0" x2="500" y2="0" stroke="#152030" strokeDasharray="3 3" />
              <line x1="0" y1="37.5" x2="500" y2="37.5" stroke="#152030" strokeDasharray="3 3" />
              <line x1="0" y1="75" x2="500" y2="75" stroke="#152030" strokeDasharray="3 3" />
              <line x1="0" y1="112.5" x2="500" y2="112.5" stroke="#152030" strokeDasharray="3 3" />
              <line x1="0" y1="150" x2="500" y2="150" stroke="#152030" />

              {/* Allowed Area & Line */}
              <path
                d="M0,130 Q40,120 80,105 T160,85 T240,40 T320,70 T400,60 T500,80 L500,150 L0,150 Z"
                fill="url(#allowedGrad)"
              />
              <path
                d="M0,130 Q40,120 80,105 T160,85 T240,40 T320,70 T400,60 T500,80"
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2.5"
              />

              {/* Blocked Area & Line */}
              <path
                d="M0,145 Q40,142 80,140 T160,135 T240,120 T320,130 T400,125 T500,135 L500,150 L0,150 Z"
                fill="url(#blockedGrad)"
              />
              <path
                d="M0,145 Q40,142 80,140 T160,135 T240,120 T320,130 T400,125 T500,135"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
              />
            </svg>
          </div>
        </div>

        {/* X Axis */}
        <div className="flex justify-between pl-8 pt-2 text-[10px] font-mono text-slate-500">
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
