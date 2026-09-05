import React from 'react';
import {
  Search,
  ChevronDown,
  FileCode2,
} from 'lucide-react';

export interface RuleItem {
  id: string;
  name: string;
  category: string;
  target: string;
  action: 'Block' | 'Log' | 'Rate Limit';
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  lastUpdated: string;
  status: 'Active' | 'Draft' | 'Disabled';
  description: string;
  scope: string;
  assignedPolicies: number;
  lastPublished: string;
  matchConditions: {
    targets: string;
    patternType: string;
    expression: string;
    scoreContribution: string;
  };
  response: {
    returnStatus: number;
    eventLogging: string;
    auditTrail: string;
  };
  recentChanges: {
    action: string;
    user: string;
    date: string;
    type: 'create' | 'update' | 'assign' | 'disable';
  }[];
}

interface RulesTableProps {
  total: number | null;
  rules: RulesTableRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (c: string) => void;
  actionFilter: string;
  onActionFilterChange: (a: string) => void;
  severityFilter: string;
  onSeverityFilterChange: (s: string) => void;
  statusFilter: string;
  onStatusFilterChange: (st: string) => void;
}

export interface RulesTableRow {
  id: string; name: string; category: string; target: string;
  action: 'Allow' | 'Block' | 'Log'; severity: 'Critical' | 'High' | 'Medium' | 'Low';
  lastUpdated: string; status: 'Enabled' | 'Disabled';
}

export function RulesTable({
  total,
  rules,
  selectedId,
  onSelect,
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  actionFilter,
  onActionFilterChange,
  severityFilter,
  onSeverityFilterChange,
  statusFilter,
  onStatusFilterChange,
}: RulesTableProps) {
  return (
    <div className={`${selectedId ? 'xl:col-span-7' : 'xl:col-span-12'} bg-[#0B1320] border border-[#172338] p-4 space-y-3 transition-all duration-200`}>
      {/* Title & Count */}
      <div className="flex items-center justify-between pb-2 border-b border-[#172338]">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-mono font-semibold text-white uppercase tracking-wider">
            Rules
          </h2>
          <span className="px-1.5 py-0.2 bg-[#172338] text-[11px] font-mono text-slate-300">
            {total === null ? '—' : `${rules.length} shown / ${total} matching`}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter rules..."
            aria-label="Search saved rules"
            maxLength={120}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-[#0E1726] border border-[#1C293D] pl-8 pr-3 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
          />
        </div>

        {/* Categories */}
        <div className="relative">
          <select
            aria-label="Filter rule group"
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors cursor-pointer"
          >
            <option>All Categories</option>
            <option>Custom</option>
            <option>SQL Injection</option>
            <option>Bot Detection</option>
            <option>Sensitive Endpoint</option>
            <option>Authentication</option>
            <option>Path Traversal</option>
            <option>XSS</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Actions */}
        <div className="relative">
          <select
            aria-label="Filter rule action"
            value={actionFilter}
            onChange={(e) => onActionFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors cursor-pointer"
          >
            <option>All Actions</option>
            <option>Block</option>
            <option>Allow</option>
            <option>Log</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Severities */}
        <div className="relative">
          <select
            aria-label="Filter rule severity"
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

        {/* Statuses */}
        <div className="relative">
          <select
            aria-label="Filter rule status"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="appearance-none bg-[#0E1726] border border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono transition-colors cursor-pointer"
          >
            <option>All Statuses</option>
            <option>Enabled</option>
            <option>Disabled</option>
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
                <div className="flex items-center gap-1">
                  <span>RULE NAME</span>
                </div>
              </th>
              <th className="py-2.5 px-3">CATEGORY</th>
              <th className="py-2.5 px-3">TARGET</th>
              <th className="py-2.5 px-3">ACTION</th>
              <th className="py-2.5 px-3">
                <div className="flex items-center gap-1">
                  <span>SEVERITY</span>
                </div>
              </th>
              <th className="py-2.5 px-3">
                <div className="flex items-center gap-1">
                  <span>LAST UPDATED</span>
                </div>
              </th>
              <th className="py-2.5 px-3">
                <div className="flex items-center gap-1">
                  <span>STATUS</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#172338]">
            {rules.map((rule) => {
              const isSelected = rule.id === selectedId;
              return (
                <tr
                  key={rule.id}
                  onClick={() => onSelect(rule.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-emerald-950/30 border-l-2 border-emerald-400 text-white'
                      : 'hover:bg-[#0E1726] text-slate-300'
                  }`}
                >
                  {/* Name + Icon */}
                  <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FileCode2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                      <button type="button" onClick={e => { e.stopPropagation(); onSelect(rule.id); }} className={isSelected ? 'text-white font-bold' : 'text-slate-200'}>
                        {rule.name}
                      </button>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="py-2.5 px-3 text-slate-400 whitespace-nowrap font-mono text-[11px]">
                    {rule.category}
                  </td>

                  {/* Target */}
                  <td className="py-2.5 px-3 text-slate-300 font-mono text-[11px] whitespace-nowrap">
                    {rule.target}
                  </td>

                  {/* Action Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    {rule.action === 'Block' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#3E1418] text-[#FCA5A5] border border-red-800">
                        BLOCK
                      </span>
                    )}
                    {rule.action === 'Log' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-blue-950 text-blue-300 border border-blue-800">
                        LOG
                      </span>
                    )}
                    {rule.action === 'Allow' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                        ALLOW
                      </span>
                    )}
                  </td>

                  {/* Severity Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    {rule.severity === 'Critical' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#451216] text-[#FCA5A5] border border-red-700 uppercase">
                        Critical
                      </span>
                    )}
                    {rule.severity === 'High' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 uppercase">
                        High
                      </span>
                    )}
                    {rule.severity === 'Medium' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-950 text-yellow-300 border border-yellow-800 uppercase">
                        Medium
                      </span>
                    )}
                    {rule.severity === 'Low' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 uppercase">
                        Low
                      </span>
                    )}
                  </td>

                  {/* Last Updated */}
                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                    {rule.lastUpdated}
                  </td>

                  {/* Status Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap font-mono">
                    {rule.status === 'Enabled' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-700 uppercase">
                        Enabled
                      </span>
                    )}
                    {rule.status === 'Disabled' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-950 text-slate-500 border border-slate-800 uppercase">
                        Disabled
                      </span>
                    )}
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
