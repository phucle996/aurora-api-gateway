import React, { useState } from 'react';
import {
  Search,
  ChevronDown,
  RotateCcw,
  Pencil,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export interface RateLimitRuleItem {
  id: string;
  name: string;
  type: string;
  key: string;
  limit: number;
  window: string;
  action: 'BLOCK' | 'RATE LIMIT';
  scope: string;
  status: 'Active' | 'Disabled';
  description: string;
}

interface RateLimitsTableProps {
  rules: RateLimitRuleItem[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  typeFilter: string;
  onTypeFilterChange: (t: string) => void;
  hostFilter: string;
  onHostFilterChange: (h: string) => void;
  onResetFilters: () => void;
}

export function RateLimitsTable({
  rules,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  typeFilter,
  onTypeFilterChange,
  hostFilter,
  onHostFilterChange,
  onResetFilters,
}: RateLimitsTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(rules.map((r) => r.id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleToggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="bg-[#0B1320] border border-[#172338] p-4 space-y-3 font-mono">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search rules by name, path, host..."
            className="w-full bg-[#0E1726] border border-[#1C293D] pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        {/* Status Dropdown */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-3 pr-7 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
          >
            <option>All Status</option>
            <option>Active</option>
            <option>Disabled</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Types Dropdown */}
        <div className="relative">
          <select
            value={typeFilter}
            onChange={(e) => onTypeFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-3 pr-7 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
          >
            <option>All Types</option>
            <option>Request</option>
            <option>Connection</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Hosts Dropdown */}
        <div className="relative">
          <select
            value={hostFilter}
            onChange={(e) => onHostFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-3 pr-7 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
          >
            <option>All Hosts</option>
            <option>api.example.com</option>
            <option>app.example.com</option>
            <option>admin.aurora.local</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Reset */}
        <button
          type="button"
          onClick={onResetFilters}
          className="flex items-center gap-1.5 bg-[#0E1726] hover:bg-[#142034] text-slate-300 border border-[#1C293D] px-3 py-1.5 text-xs transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
          <span>Reset</span>
        </button>
      </div>

      {/* Table Container */}
      <div className="border border-[#172338] overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-[#09101B] border-b border-[#172338] text-slate-400 font-mono text-[11px] select-none">
              <th className="py-2.5 px-3 w-8">
                <input
                  type="checkbox"
                  checked={
                    rules.length > 0 && selectedIds.length === rules.length
                  }
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="w-3.5 h-3.5 border-[#2B3B52] bg-[#111A29] text-emerald-500 focus:ring-0 cursor-pointer accent-emerald-500"
                />
              </th>
              <th className="py-2.5 px-3">NAME</th>
              <th className="py-2.5 px-3">TYPE</th>
              <th className="py-2.5 px-3">KEY</th>
              <th className="py-2.5 px-3">LIMIT</th>
              <th className="py-2.5 px-3">WINDOW</th>
              <th className="py-2.5 px-3">ACTION</th>
              <th className="py-2.5 px-3">SCOPE</th>
              <th className="py-2.5 px-3">STATUS</th>
              <th className="py-2.5 px-3">DESCRIPTION</th>
              <th className="py-2.5 px-3 text-right">ACTIONS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#172338]">
            {rules.map((rule) => {
              const isChecked = selectedIds.includes(rule.id);
              return (
                <tr
                  key={rule.id}
                  className={`transition-colors ${
                    isChecked
                      ? 'bg-emerald-950/20 text-white'
                      : 'hover:bg-[#0E1726] text-slate-300'
                  }`}
                >
                  <td className="py-2.5 px-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleRow(rule.id)}
                      className="w-3.5 h-3.5 border-[#2B3B52] bg-[#111A29] text-emerald-500 focus:ring-0 cursor-pointer accent-emerald-500"
                    />
                  </td>

                  {/* Name */}
                  <td className="py-2.5 px-3 font-semibold text-white whitespace-nowrap">
                    {rule.name}
                  </td>

                  {/* Type */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#142034] text-cyan-300 border border-[#233857]">
                      {rule.type}
                    </span>
                  </td>

                  {/* Key */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                    {rule.key}
                  </td>

                  {/* Limit */}
                  <td className="py-2.5 px-3 font-mono text-[11px] font-bold text-white whitespace-nowrap">
                    {rule.limit}
                  </td>

                  {/* Window */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                    {rule.window}
                  </td>

                  {/* Action Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {rule.action === 'BLOCK' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#3E1418] text-[#FCA5A5] border border-red-800 uppercase">
                        BLOCK
                      </span>
                    )}
                    {rule.action === 'RATE LIMIT' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 uppercase">
                        RATE LIMIT
                      </span>
                    )}
                  </td>

                  {/* Scope */}
                  <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                    {rule.scope}
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      <span>{rule.status}</span>
                    </span>
                  </td>

                  {/* Description */}
                  <td className="py-2.5 px-3 text-slate-400 text-[11px] max-w-[200px] truncate">
                    {rule.description}
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#152338] transition-colors cursor-pointer"
                        title="Edit Rule"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#152338] transition-colors cursor-pointer"
                        title="Clone Rule"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 text-slate-400 hover:text-rose-400 hover:bg-[#152338] transition-colors cursor-pointer"
                        title="Delete Rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 text-[11px] text-slate-400 font-mono">
        <div>
          Showing 1 to {rules.length} of 18 rules
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 bg-[#0E1726] border border-[#1C293D] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="px-2 py-0.5 bg-emerald-600 text-white font-bold"
          >
            1
          </button>
          <button
            type="button"
            className="px-2 py-0.5 bg-[#0E1726] border border-[#1C293D] text-slate-300 hover:text-white hover:bg-[#142034] transition-colors cursor-pointer"
          >
            2
          </button>
          <button
            type="button"
            className="px-2 py-0.5 bg-[#0E1726] border border-[#1C293D] text-slate-300 hover:text-white hover:bg-[#142034] transition-colors cursor-pointer"
          >
            3
          </button>
          <button
            type="button"
            className="p-1 bg-[#0E1726] border border-[#1C293D] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
