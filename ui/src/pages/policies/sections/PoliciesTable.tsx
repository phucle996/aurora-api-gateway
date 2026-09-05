import React from 'react';
import { Search, FileText, MoreHorizontal, ChevronDown } from 'lucide-react';

export interface PolicyItem {
  id: string;
  name: string;
  scope: string;
  mode: 'Mixed' | 'Block' | 'Detect';
  ruleSetsCount: number;
  lastUpdated: string;
  status: 'Published' | 'Draft' | 'Disabled';
  description: string;
  priority: 'High' | 'Medium' | 'Low';
  assignedEnv?: string;
  ruleGroups: string[];
}

interface PoliciesTableProps {
  policies: PolicyItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
}

export function PoliciesTable({
  policies,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
}: PoliciesTableProps) {
  return (
    <div className={`${selectedId ? 'xl:col-span-7' : 'xl:col-span-12'} bg-[#0B1320] border border-[#172338] p-4 space-y-3 transition-all duration-200`}>
      {/* Table Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#172338]">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
            Policies
          </h2>
          <span className="px-1.5 py-0.2 bg-[#172338] text-[11px] font-mono text-slate-300">
            {policies.length}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter policies..."
              className="bg-[#0E1726] border border-[#1C293D] pl-8 pr-3 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors font-mono w-44"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-300 focus:outline-none focus:border-emerald-500 transition-colors font-mono cursor-pointer"
            >
              <option>All Statuses</option>
              <option>Published</option>
              <option>Draft</option>
              <option>Disabled</option>
            </select>
            <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-[#172338] overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#09101B] border-b border-[#18263D] text-[11px] font-mono text-slate-400 select-none">
              <th className="py-2.5 px-3">POLICY NAME</th>
              <th className="py-2.5 px-3">SCOPE</th>
              <th className="py-2.5 px-3">MODE</th>
              <th className="py-2.5 px-3">RULE SETS</th>
              <th className="py-2.5 px-3">LAST UPDATED</th>
              <th className="py-2.5 px-3">STATUS</th>
              <th className="py-2.5 px-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#18263D]">
            {policies.map((p) => {
              const isSelected = p.id === selectedId;
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-emerald-950/30 border-l-2 border-emerald-400 text-white'
                      : 'hover:bg-[#0E1726] text-slate-300'
                  }`}
                >
                  <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FileText
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                      <span className={isSelected ? 'text-white font-bold' : 'text-slate-200'}>
                        {p.name}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                    {p.scope}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-bold border uppercase ${
                        p.mode === 'Block'
                          ? 'bg-rose-950 text-rose-300 border-rose-800'
                          : p.mode === 'Detect'
                          ? 'bg-blue-950 text-blue-300 border-blue-800'
                          : 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      }`}
                    >
                      {p.mode}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                    {p.ruleSetsCount} rules
                  </td>
                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                    {p.lastUpdated}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-bold border uppercase ${
                        p.status === 'Published'
                          ? 'bg-emerald-950 text-emerald-400 border-emerald-700'
                          : p.status === 'Draft'
                          ? 'bg-slate-900 text-slate-300 border-slate-700'
                          : 'bg-slate-950 text-slate-500 border-slate-800'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    <button
                      type="button"
                      className="p-1 text-slate-500 hover:text-slate-200 hover:bg-[#18263D] transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(p.id);
                      }}
                      aria-label={`View ${p.name}`}
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
