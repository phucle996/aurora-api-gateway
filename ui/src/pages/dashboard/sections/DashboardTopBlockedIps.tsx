import React from 'react';
import { Link } from 'react-router-dom';

export function DashboardTopBlockedIps() {
  const ips = [
    { ip: '45.142.120.23', requests: '12,421', blockRate: 100 },
    { ip: '103.76.18.95', requests: '8,932', blockRate: 98 },
    { ip: '185.199.110.44', requests: '7,210', blockRate: 97 },
    { ip: '91.214.23.10', requests: '6,543', blockRate: 96 },
    { ip: '176.9.12.33', requests: '5,421', blockRate: 95 },
  ];

  return (
    <div className="bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#152030]">
        <span className="text-sm font-semibold text-slate-900 dark:text-white font-sans">
          Top Source IPs (Blocked)
        </span>
        <Link
          to="/ip-access"
          className="text-xs font-sans text-blue-600 dark:text-cyan-400 hover:underline transition-colors"
        >
          View All
        </Link>
      </div>

      {/* Table */}
      <div className="py-2 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs font-sans">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#152030] pb-1">
              <th className="py-1.5 font-normal">IP Address</th>
              <th className="py-1.5 font-normal">Requests</th>
              <th className="py-1.5 font-normal text-right">Block Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#152030]/50">
            {ips.map((item) => (
              <tr key={item.ip} className="hover:bg-slate-50 dark:hover:bg-[#0E1726]/50 transition-colors">
                <td className="py-2 text-slate-800 dark:text-slate-200 font-bold">{item.ip}</td>
                <td className="py-2 text-slate-600 dark:text-slate-400">{item.requests}</td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-rose-600 dark:text-rose-400 font-semibold">{item.blockRate}%</span>
                    <div className="w-16 h-1.5 bg-slate-100 dark:bg-[#152030] overflow-hidden rounded-full">
                      <div
                        className="h-full bg-rose-500"
                        style={{ width: `${item.blockRate}%` }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
