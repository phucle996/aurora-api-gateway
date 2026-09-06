import React from 'react';
import {
  Search,
  ChevronDown,
  FileCode2,
  ChevronLeft,
  ChevronRight,
  ChevronFirst,
  RotateCcw,
} from 'lucide-react';
import { cn } from 'cn';

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
  currentPage: number;
  totalPages: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  loading: boolean;
  knownPages: number[];
  onFirstPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPageSelect: (page: number) => void;
  onRefresh: () => void;
}

export interface RulesTableRow {
  id: string; name: string; category: string; target: string;
  action: 'Allow' | 'Block' | 'Log'; severity: 'Critical' | 'High' | 'Medium' | 'Low';
  lastUpdated: string; status: 'Enabled' | 'Disabled';
}

function getPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: (number | 'ellipsis')[] = [1];
  if (current > 3) {
    pages.push('ellipsis');
  }
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (current < total - 2) {
    pages.push('ellipsis');
  }
  pages.push(total);
  return pages;
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
  currentPage,
  totalPages,
  pageSize,
  hasNextPage,
  hasPrevPage,
  loading,
  knownPages,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onPageSelect,
  onRefresh,
}: RulesTableProps) {
  const pageNumbers = getPageNumbers(currentPage, totalPages);

  return (
    <div className={`${selectedId ? 'xl:col-span-7' : 'xl:col-span-12'} bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 space-y-3 shadow-xs rounded-sm transition-all duration-200`}>
      {/* Title & Count */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-[#172338]">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-sans font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
            Rules
          </h2>
          <span className="px-1.5 py-0.2 bg-slate-100 dark:bg-[#172338] text-[11px] font-sans text-slate-700 dark:text-slate-300 rounded-xs">
            {total === null ? '—' : `${rules.length} shown / ${total} matching`}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter rules..."
            aria-label="Search saved rules"
            maxLength={120}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] pl-8 pr-3 py-1 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-blue-500 rounded-sm font-sans transition-colors"
          />
        </div>

        {/* Categories */}
        <div className="relative">
          <select
            aria-label="Filter rule group"
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value)}
            className="appearance-none bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 rounded-sm font-sans transition-colors cursor-pointer"
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
          <ChevronDown className="w-3 h-3 text-slate-400 dark:text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Actions */}
        <div className="relative">
          <select
            aria-label="Filter rule action"
            value={actionFilter}
            onChange={(e) => onActionFilterChange(e.target.value)}
            className="appearance-none bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 rounded-sm font-sans transition-colors cursor-pointer"
          >
            <option>All Actions</option>
            <option>Block</option>
            <option>Allow</option>
            <option>Log</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-400 dark:text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Severities */}
        <div className="relative">
          <select
            aria-label="Filter rule severity"
            value={severityFilter}
            onChange={(e) => onSeverityFilterChange(e.target.value)}
            className="appearance-none bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 rounded-sm font-sans transition-colors cursor-pointer"
          >
            <option>All Severities</option>
            <option>Critical</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-400 dark:text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Statuses */}
        <div className="relative">
          <select
            aria-label="Filter rule status"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="appearance-none bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] pl-2.5 pr-6 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 rounded-sm font-sans transition-colors cursor-pointer"
          >
            <option>All Statuses</option>
            <option>Enabled</option>
            <option>Disabled</option>
          </select>
          <ChevronDown className="w-3 h-3 text-slate-400 dark:text-slate-500 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Table Container */}
      <div className="border border-slate-200 dark:border-[#172338] overflow-x-auto rounded-sm">
        <table className="w-full text-left text-xs border-collapse font-sans">
          <thead>
            <tr className="bg-slate-50 dark:bg-[#09101B] border-b border-slate-200 dark:border-[#172338] text-slate-500 dark:text-slate-400 font-sans text-[11px] font-semibold select-none">
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
          <tbody className="divide-y divide-slate-100 dark:divide-[#172338]">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 font-sans">
                  No saved rules match these filters.
                </td>
              </tr>
            ) : (
              rules.map((rule) => {
                const isSelected = rule.id === selectedId;
              return (
                <tr
                  key={rule.id}
                  onClick={() => onSelect(rule.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-emerald-950/30 border-l-2 border-blue-600 dark:border-emerald-400 text-slate-900 dark:text-white'
                      : 'hover:bg-slate-50 dark:hover:bg-[#0E1726] text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {/* Name + Icon */}
                  <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FileCode2
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-blue-600 dark:text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                      <button type="button" onClick={e => { e.stopPropagation(); onSelect(rule.id); }} className={isSelected ? 'text-slate-900 dark:text-white font-bold' : 'text-slate-800 dark:text-slate-200'}>
                        {rule.name}
                      </button>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 whitespace-nowrap font-sans text-xs">
                    {rule.category}
                  </td>

                  {/* Target */}
                  <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300 font-mono text-[11px] whitespace-nowrap">
                    {rule.target}
                  </td>

                  {/* Action Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {rule.action === 'Block' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-red-100 dark:bg-[#3E1418] text-red-700 dark:text-[#FCA5A5] border border-red-300 dark:border-red-800 rounded-xs">
                        BLOCK
                      </span>
                    )}
                    {rule.action === 'Log' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800 rounded-xs">
                        LOG
                      </span>
                    )}
                    {rule.action === 'Allow' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-cyan-100 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-300 dark:border-cyan-800 rounded-xs">
                        ALLOW
                      </span>
                    )}
                  </td>

                  {/* Severity Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {rule.severity === 'Critical' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-red-100 dark:bg-[#451216] text-red-700 dark:text-[#FCA5A5] border border-red-300 dark:border-red-700 uppercase rounded-xs">
                        Critical
                      </span>
                    )}
                    {rule.severity === 'High' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 uppercase rounded-xs">
                        High
                      </span>
                    )}
                    {rule.severity === 'Medium' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-yellow-100 dark:bg-yellow-950 text-yellow-700 dark:text-yellow-300 border border-yellow-300 dark:border-yellow-800 uppercase rounded-xs">
                        Medium
                      </span>
                    )}
                    {rule.severity === 'Low' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-slate-700 uppercase rounded-xs">
                        Low
                      </span>
                    )}
                  </td>

                  {/* Last Updated */}
                  <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400 font-sans text-xs whitespace-nowrap">
                    {rule.lastUpdated}
                  </td>

                  {/* Status Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {rule.status === 'Enabled' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 uppercase rounded-xs">
                        Enabled
                      </span>
                    )}
                    {rule.status === 'Disabled' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-slate-200 dark:bg-slate-950 text-slate-500 border border-slate-300 dark:border-slate-800 uppercase rounded-xs">
                        Disabled
                      </span>
                    )}
                  </td>

                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#172338]/60 text-xs text-slate-500 dark:text-slate-400 font-sans">
        <div className="flex items-center gap-3">
          <div>
            {total === null || total === 0 ? (
              <span>0 rules</span>
            ) : (
              <span>
                Showing <span className="font-semibold text-slate-700 dark:text-slate-200">{rules.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> to{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">{rules.length > 0 ? (currentPage - 1) * pageSize + rules.length : 0}</span> of{' '}
                <span className="font-semibold text-slate-700 dark:text-slate-200">{total}</span> {total === 1 ? 'rule' : 'rules'}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh rules"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#142034] hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
          >
            <RotateCcw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="First page"
            title="First page"
            disabled={!hasPrevPage || loading}
            onClick={onFirstPage}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#142034] hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
          >
            <ChevronFirst className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">First page</span>
          </button>

          <button
            type="button"
            aria-label="Previous page"
            title="Previous page"
            disabled={!hasPrevPage || loading}
            onClick={onPrevPage}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#142034] hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Previous</span>
          </button>

          <div className="flex items-center gap-1 px-1">
            {pageNumbers.map((p, idx) => {
              if (p === 'ellipsis') {
                return (
                  <span key={`ellipsis-${idx}`} className="px-1 text-slate-400 dark:text-slate-600 select-none">
                    …
                  </span>
                );
              }
              const isActive = p === currentPage;
              const isAvailable = p === 1 || knownPages.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-label={`Page ${p}`}
                  aria-current={isActive ? 'page' : undefined}
                  disabled={loading || isActive || !isAvailable}
                  onClick={() => onPageSelect(p)}
                  className={cn(
                    "min-w-[26px] h-6 px-1.5 text-[11px] font-sans font-medium rounded-sm transition-colors cursor-pointer flex items-center justify-center",
                    isActive
                      ? "bg-blue-600 text-white font-bold cursor-default"
                      : isAvailable
                      ? "bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#142034] hover:text-slate-900 dark:hover:text-white"
                      : "bg-slate-50/50 dark:bg-[#0E1726]/50 border border-slate-200/40 dark:border-[#1C293D]/40 text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50"
                  )}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            aria-label="Next page"
            title="Next page"
            disabled={!hasNextPage || loading}
            onClick={onNextPage}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#142034] hover:text-slate-900 dark:hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
          >
            <span className="hidden sm:inline">Next page</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
