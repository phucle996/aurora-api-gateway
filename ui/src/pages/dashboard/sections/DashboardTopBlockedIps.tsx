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
    <div className="bg-card border border-border p-4 flex flex-col justify-between shadow-xs rounded-sm transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <span className="text-sm font-semibold text-foreground font-sans">
          Top Source IPs (Blocked)
        </span>
        <Link
          to="/ip-access"
          className="text-xs font-sans text-primary hover:underline transition-colors"
        >
          View All
        </Link>
      </div>

      {/* Table */}
      <div className="py-2 overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs font-sans">
          <thead>
            <tr className="text-muted-foreground border-b border-border pb-1">
              <th className="py-1.5 font-normal">IP Address</th>
              <th className="py-1.5 font-normal">Requests</th>
              <th className="py-1.5 font-normal text-right">Block Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr>
              <td colSpan={3} className="py-8 text-center text-muted-foreground">
                No blocked source IPs recorded in this period.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
