import React from 'react';
import { Link } from 'react-router-dom';

export function DashboardRecentEvents() {
  const events = [
    { time: '10:24:12', type: 'SQLi', color: 'text-rose-400 bg-rose-950/40 border-rose-500/30', ip: '45.142.120.23', path: '/login' },
    { time: '10:23:45', type: 'XSS', color: 'text-orange-400 bg-orange-950/40 border-orange-500/30', ip: '103.76.18.95', path: '/search' },
    { time: '10:21:03', type: 'LFI', color: 'text-amber-400 bg-amber-950/40 border-amber-500/30', ip: '91.214.23.10', path: '/wp-content/..' },
    { time: '10:18:44', type: 'Bad Bot', color: 'text-blue-400 bg-blue-950/40 border-blue-500/30', ip: '176.9.12.33', path: '/api/v1' },
    { time: '10:15:20', type: 'Rate Limit', color: 'text-purple-400 bg-purple-950/40 border-purple-500/30', ip: '185.199.110.44', path: '/upload' },
    { time: '10:14:11', type: 'SQLi', color: 'text-rose-400 bg-rose-950/40 border-rose-500/30', ip: '45.142.120.23', path: '/admin' },
    { time: '10:12:36', type: 'XSS', color: 'text-orange-400 bg-orange-950/40 border-orange-500/30', ip: '103.76.18.95', path: '/comment' },
    { time: '10:10:05', type: 'LFI', color: 'text-amber-400 bg-amber-950/40 border-amber-500/30', ip: '91.214.23.10', path: '/.env' },
  ];

  return (
    <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 flex flex-col justify-between font-sans shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#152030]">
        <span className="text-sm font-semibold text-slate-900 dark:text-white">
          Recent Security Events
        </span>
        <Link
          to="/events"
          className="text-xs text-blue-600 dark:text-cyan-400 hover:underline transition-colors"
        >
          View All
        </Link>
      </div>

      {/* Events Table */}
      <div className="py-2 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#152030]">
              <th className="py-1.5 font-normal">Time</th>
              <th className="py-1.5 font-normal">Type</th>
              <th className="py-1.5 font-normal">Source IP</th>
              <th className="py-1.5 font-normal">Path</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#152030]/50">
            {events.map((evt, idx) => (
              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#0E1726]/50 transition-colors">
                <td className="py-1.5 text-slate-500 dark:text-slate-400">{evt.time}</td>
                <td className="py-1.5">
                  <span className={`inline-flex items-center px-1.5 py-0.5 border text-[10px] rounded-xs font-bold ${evt.color}`}>
                    {evt.type}
                  </span>
                </td>
                <td className="py-1.5 text-slate-800 dark:text-slate-200">{evt.ip}</td>
                <td className="py-1.5 text-blue-600 dark:text-cyan-400 font-mono">{evt.path}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
