import React, { useState } from 'react';
import {
  Search,
  ChevronDown,
  RotateCcw,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export interface AccessRuleItem {
  id: string;
  type: 'BLOCK' | 'ALLOW' | 'TEMP BAN' | 'GEO BLOCK' | 'ASN BLOCK';
  value: string;
  countryOrAsn?: string;
  countryFlag?: string;
  scope: string;
  reason: string;
  status: 'Active' | 'Disabled' | 'Expired';
  expiresAt?: string;
}

interface IpAccessTableProps {
  rules: AccessRuleItem[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  typeFilter: string;
  onTypeFilterChange: (t: string) => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  onResetFilters: () => void;
}

export function IpAccessTable({
  rules,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  onResetFilters,
}: IpAccessTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const tabs = [
    'All Rules',
    'Allowlist',
    'Blocklist',
    'Temporary Bans',
    'Geo Rules',
    'ASN Rules',
  ];

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
    <div className="bg-[#0B1320] border border-[#172338] p-4 space-y-3 font-sans">
      {/* Tabs Row */}
      <div className="flex items-center gap-1 border-b border-[#172338] pb-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer shrink-0 border-b-2 font-sans ${
              activeTab === tab
                ? 'text-emerald-400 border-emerald-400 bg-emerald-950/20'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-[#0E1726]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search IP, CIDR, country, ASN, note..."
            className="w-full bg-[#0E1726] border border-[#1C293D] pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 transition-colors"
          />
        </div>

        {/* Type Filter */}
        <div className="relative">
          <select
            value={typeFilter}
            onChange={(e) => onTypeFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-3 pr-7 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
          >
            <option>All Types</option>
            <option>BLOCK</option>
            <option>ALLOW</option>
            <option>TEMP BAN</option>
            <option>GEO BLOCK</option>
            <option>ASN BLOCK</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Status Filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-3 pr-7 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors cursor-pointer"
          >
            <option>All Status</option>
            <option>Active</option>
            <option>Disabled</option>
            <option>Expired</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Reset Button */}
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
        <table className="w-full text-left text-xs border-collapse font-sans">
          <thead>
            <tr className="bg-[#09101B] border-b border-[#172338] text-slate-400 font-sans text-xs select-none">
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
              <th className="py-2.5 px-3">TYPE</th>
              <th className="py-2.5 px-3">VALUE</th>
              <th className="py-2.5 px-3">COUNTRY / ASN</th>
              <th className="py-2.5 px-3">SCOPE</th>
              <th className="py-2.5 px-3">REASON / NOTE</th>
              <th className="py-2.5 px-3">STATUS</th>
              <th className="py-2.5 px-3">EXPIRES AT</th>
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

                  {/* Type Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {rule.type === 'BLOCK' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#3E1418] text-[#FCA5A5] border border-red-800 uppercase">
                        BLOCK
                      </span>
                    )}
                    {rule.type === 'ALLOW' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 uppercase">
                        ALLOW
                      </span>
                    )}
                    {rule.type === 'TEMP BAN' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 uppercase">
                        TEMP BAN
                      </span>
                    )}
                    {rule.type === 'GEO BLOCK' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-950 text-purple-300 border border-purple-800 uppercase">
                        GEO BLOCK
                      </span>
                    )}
                    {rule.type === 'ASN BLOCK' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 uppercase">
                        ASN BLOCK
                      </span>
                    )}
                  </td>

                  {/* Value */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-200 font-semibold whitespace-nowrap">
                    {rule.value}
                  </td>

                  {/* Country / ASN */}
                  <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap text-[11px]">
                    {rule.countryOrAsn ? (
                      <div className="flex items-center gap-1.5">
                        {rule.countryFlag && <span>{rule.countryFlag}</span>}
                        <span>{rule.countryOrAsn}</span>
                      </div>
                    ) : (
                      <span>-</span>
                    )}
                  </td>

                  {/* Scope */}
                  <td className="py-2.5 px-3 text-slate-300 whitespace-nowrap text-[11px]">
                    {rule.scope}
                  </td>

                  {/* Reason / Note */}
                  <td className="py-2.5 px-3 text-slate-400 max-w-[180px] truncate text-[11px]">
                    {rule.reason}
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      <span>{rule.status}</span>
                    </span>
                  </td>

                  {/* Expires At */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400 whitespace-nowrap">
                    {rule.expiresAt || '-'}
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 text-xs text-slate-400 font-sans">
        <div>
          Showing 1 to {rules.length} of 126 results
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
            className="px-2 py-0.5 bg-[#0E1726] border border-[#1C293D] text-slate-300 hover:text-white hover:bg-[#142034] transition-colors cursor-pointer"
          >
            4
          </button>
          <button
            type="button"
            className="px-2 py-0.5 bg-[#0E1726] border border-[#1C293D] text-slate-300 hover:text-white hover:bg-[#142034] transition-colors cursor-pointer"
          >
            5
          </button>
          <span className="px-1 text-slate-600">...</span>
          <button
            type="button"
            className="px-2 py-0.5 bg-[#0E1726] border border-[#1C293D] text-slate-300 hover:text-white hover:bg-[#142034] transition-colors cursor-pointer"
          >
            13
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
