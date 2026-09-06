import React, { useState } from 'react';

export function DashboardAttackTypes() {
  const [range, setRange] = useState('Last 24 hours');

  const attackTypes = [
    { name: 'SQL Injection', percent: '28.4%', color: 'var(--chart-1)' },
    { name: 'XSS', percent: '24.1%', color: 'var(--chart-2)' },
    { name: 'LFI / RFI', percent: '14.7%', color: 'var(--chart-3)' },
    { name: 'Bad Bot', percent: '12.3%', color: 'var(--chart-4)' },
    { name: 'Rate Limit', percent: '10.1%', color: 'var(--chart-5)' },
    { name: 'Others', percent: '10.4%', color: 'var(--chart-6)' },
  ];

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
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

      {/* Body: Donut + Legend */}
      <div className="flex flex-col sm:flex-row items-center gap-6 py-3">
        {/* Donut Chart */}
        <div className="relative w-36 h-36 shrink-0 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
            {/* SVG Segments */}
            {/* SQLi 28.4% -> stroke-dasharray: 28.4 71.6 */}
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="transparent"
              stroke="var(--chart-1)"
              strokeWidth="14"
              strokeDasharray="28.4 71.6"
              strokeDashoffset="0"
            />
            {/* XSS 24.1% */}
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="transparent"
              stroke="var(--chart-2)"
              strokeWidth="14"
              strokeDasharray="24.1 75.9"
              strokeDashoffset="-28.4"
            />
            {/* LFI 14.7% */}
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="transparent"
              stroke="var(--chart-3)"
              strokeWidth="14"
              strokeDasharray="14.7 85.3"
              strokeDashoffset="-52.5"
            />
            {/* Bad Bot 12.3% */}
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="transparent"
              stroke="var(--chart-4)"
              strokeWidth="14"
              strokeDasharray="12.3 87.7"
              strokeDashoffset="-67.2"
            />
            {/* Rate Limit 10.1% */}
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="transparent"
              stroke="var(--chart-5)"
              strokeWidth="14"
              strokeDasharray="10.1 89.9"
              strokeDashoffset="-79.5"
            />
            {/* Others 10.4% */}
            <circle
              cx="50"
              cy="50"
              r="38"
              fill="transparent"
              stroke="var(--chart-6)"
              strokeWidth="14"
              strokeDasharray="10.4 89.6"
              strokeDashoffset="-89.6"
            />
          </svg>

          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center font-sans">
            <span className="text-sm font-bold text-foreground leading-none">342.1K</span>
            <span className="text-[9px] text-muted-foreground mt-0.5">Blocked</span>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 w-full space-y-1.5 text-xs font-sans">
          {attackTypes.map((item) => (
            <div key={item.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 inline-block shrink-0 rounded-xs"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-muted-foreground">{item.name}</span>
              </div>
              <span className="text-foreground font-semibold">{item.percent}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
