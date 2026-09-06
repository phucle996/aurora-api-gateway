import React from 'react';
import { Link } from 'react-router-dom';

export function DashboardRecentEvents() {
  const events = [
    { time: '10:24:12', type: 'SQLi', color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-500/30', ip: '45.142.120.23', path: '/login' },
    { time: '10:23:45', type: 'XSS', color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-500/30', ip: '103.76.18.95', path: '/search' },
    { time: '10:21:03', type: 'LFI', color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-500/30', ip: '91.214.23.10', path: '/wp-content/..' },
    { time: '10:18:44', type: 'Bad Bot', color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-500/30', ip: '176.9.12.33', path: '/api/v1' },
    { time: '10:15:20', type: 'Rate Limit', color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-500/30', ip: '185.199.110.44', path: '/upload' },
    { time: '10:14:11', type: 'SQLi', color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-500/30', ip: '45.142.120.23', path: '/admin' },
    { time: '10:12:36', type: 'XSS', color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-500/30', ip: '103.76.18.95', path: '/comment' },
    { time: '10:10:05', type: 'LFI', color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-500/30', ip: '91.214.23.10', path: '/.env' },
  ];

  return (
    <div className="bg-card border border-border p-4 flex flex-col justify-between font-sans shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground">
          Recent Security Events
        </span>
        <Link
          to="/events"
          className="text-xs text-primary hover:underline transition-colors"
        >
          View All
        </Link>
      </div>

      {/* Events Table */}
      <div className="py-2 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="py-1.5 font-normal">Time</th>
              <th className="py-1.5 font-normal">Type</th>
              <th className="py-1.5 font-normal">Source IP</th>
              <th className="py-1.5 font-normal">Path</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((evt, idx) => (
              <tr key={idx} className="hover:bg-muted/50 transition-colors">
                <td className="py-1.5 text-muted-foreground">{evt.time}</td>
                <td className="py-1.5">
                  <span className={`inline-flex items-center px-1.5 py-0.5 border text-[10px] rounded-xs font-bold ${evt.color}`}>
                    {evt.type}
                  </span>
                </td>
                <td className="py-1.5 text-foreground">{evt.ip}</td>
                <td className="py-1.5 text-primary font-mono">{evt.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
