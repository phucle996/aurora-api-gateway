import React from 'react';
import { Search, ChevronDown, ArrowUpDown, MoreHorizontal } from 'lucide-react';

export interface EventItem {
  id: string;
  eventId: string;
  title: string;
  time: string;
  sourceIp: string;
  host: string;
  method: string;
  path: string;
  action: 'BLOCK' | 'LOG' | 'RATE LIMIT';
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  rule: string;
  status: 'Investigating' | 'New' | 'Resolved';
  queryString: string;
  userAgent: string;
  country: string;
  countryCode: string;
  countryFlag: string;
  response: {
    statusCode: number;
    auditLogged: string;
    wafNode: string;
  };
  recentNotes: {
    icon: string;
    note: string;
    user: string;
    date: string;
  }[];
}

interface EventsTableProps {
  events: EventItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  actionFilter: string;
  onActionFilterChange: (a: string) => void;
  severityFilter: string;
  onSeverityFilterChange: (s: string) => void;
  hostFilter: string;
  onHostFilterChange: (h: string) => void;
  timeFilter: string;
  onTimeFilterChange: (t: string) => void;
}

export function EventsTable({
  events,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  actionFilter,
  onActionFilterChange,
  severityFilter,
  onSeverityFilterChange,
  hostFilter,
  onHostFilterChange,
  timeFilter,
  onTimeFilterChange,
}: EventsTableProps) {
  return (
    <div className={`${selectedId ? 'xl:col-span-7' : 'xl:col-span-12'} bg-[#0B1320] border border-[#172338] p-4 space-y-3 transition-all duration-200`}>
      {/* Title & Count */}
      <div className="flex items-center justify-between pb-2 border-b border-[#172338]">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
            Events
          </h2>
          <span className="px-1.5 py-0.2 bg-[#172338] text-[11px] font-mono text-slate-300">
            18,432
          </span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter events..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] pl-8 pr-3 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
          />
        </div>

        {/* Actions Dropdown */}
        <div className="relative">
          <select
            value={actionFilter}
            onChange={(e) => onActionFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors cursor-pointer"
          >
            <option>All Actions</option>
            <option>BLOCK</option>
            <option>LOG</option>
            <option>RATE LIMIT</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Severities Dropdown */}
        <div className="relative">
          <select
            value={severityFilter}
            onChange={(e) => onSeverityFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors cursor-pointer"
          >
            <option>All Severities</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Hosts Dropdown */}
        <div className="relative">
          <select
            value={hostFilter}
            onChange={(e) => onHostFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors cursor-pointer"
          >
            <option>All Hosts</option>
            <option>api.example.com</option>
            <option>app.example.com</option>
            <option>admin.aurora.local</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Time Window Dropdown */}
        <div className="relative">
          <select
            value={timeFilter}
            onChange={(e) => onTimeFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors cursor-pointer"
          >
            <option>Last 24 Hours</option>
            <option>Last 7 Days</option>
            <option>Last 30 Days</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Table Container */}
      <div className="border border-[#172338] overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#09101B] border-b border-[#172338] text-slate-400 font-mono text-[11px] select-none">
              <th className="py-2.5 px-3">
                <div className="flex items-center gap-1 cursor-pointer hover:text-slate-200">
                  <span>TIME</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th className="py-2.5 px-3">SOURCE IP</th>
              <th className="py-2.5 px-3">HOST</th>
              <th className="py-2.5 px-2">METHOD</th>
              <th className="py-2.5 px-3">PATH</th>
              <th className="py-2.5 px-3">ACTION</th>
              <th className="py-2.5 px-3">SEVERITY</th>
              <th className="py-2.5 px-3">RULE</th>
              <th className="py-2.5 px-3">
                <div className="flex items-center gap-1 cursor-pointer hover:text-slate-200">
                  <span>STATUS</span>
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </div>
              </th>
              <th className="py-2.5 px-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#172338]">
            {events.map((evt) => {
              const isSelected = evt.id === selectedId;
              return (
                <tr
                  key={evt.id}
                  onClick={() => onSelect(evt.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-emerald-950/30 border-l-2 border-emerald-400 text-white'
                      : 'hover:bg-[#0E1726] text-slate-300'
                  }`}
                >
                  {/* Time */}
                  <td className="py-2.5 px-3 font-mono text-[11px] whitespace-nowrap text-slate-400">
                    {evt.time}
                  </td>

                  {/* Source IP */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                    {evt.sourceIp}
                  </td>

                  {/* Host */}
                  <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap font-mono text-[11px]">
                    {evt.host}
                  </td>

                  {/* Method */}
                  <td className="py-2.5 px-2 font-mono text-[11px] font-bold text-slate-200 whitespace-nowrap">
                    {evt.method}
                  </td>

                  {/* Path */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300 max-w-[130px] truncate">
                    {evt.path}
                  </td>

                  {/* Action Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    {evt.action === 'BLOCK' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#3E1418] text-[#FCA5A5] border border-red-800">
                        BLOCK
                      </span>
                    )}
                    {evt.action === 'LOG' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
                        LOG
                      </span>
                    )}
                    {evt.action === 'RATE LIMIT' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                        RATE LIMIT
                      </span>
                    )}
                  </td>

                  {/* Severity Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    {evt.severity === 'Critical' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#451216] text-[#FCA5A5] border border-red-700 uppercase">
                        Critical
                      </span>
                    )}
                    {evt.severity === 'High' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 uppercase">
                        High
                      </span>
                    )}
                    {evt.severity === 'Medium' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-950 text-yellow-300 border border-yellow-800 uppercase">
                        Medium
                      </span>
                    )}
                    {evt.severity === 'Low' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                        Low
                      </span>
                    )}
                  </td>

                  {/* Rule */}
                  <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px] max-w-[110px] truncate whitespace-nowrap">
                    {evt.rule}
                  </td>

                  {/* Status Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    {evt.status === 'Investigating' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700 uppercase">
                        Investigating
                      </span>
                    )}
                    {evt.status === 'New' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 uppercase">
                        New
                      </span>
                    )}
                    {evt.status === 'Resolved' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-900 text-slate-400 border border-slate-700 uppercase">
                        Resolved
                      </span>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-2 text-right">
                    <button
                      type="button"
                      className="p-1 text-slate-500 hover:text-slate-200 hover:bg-[#152338] transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
