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
    <div className={`${selectedId ? 'xl:col-span-7' : 'xl:col-span-12'} bg-card border border-border p-4 space-y-3 shadow-xs rounded-sm transition-all duration-200`}>
      {/* Title & Count */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-sans font-semibold text-foreground uppercase tracking-wider">
            Rules
          </h2>
          <span className="px-1.5 py-0.2 bg-muted text-[11px] font-sans text-muted-foreground rounded-xs">
            {total === null ? '—' : `${rules.length} shown / ${total} matching`}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter rules..."
            aria-label="Search saved rules"
            maxLength={120}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full bg-background border border-input pl-8 pr-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded-sm font-sans transition-colors"
          />
        </div>

        {/* Categories */}
        <div className="relative">
          <select
            aria-label="Filter rule group"
            value={categoryFilter}
            onChange={(e) => onCategoryFilterChange(e.target.value)}
            className="appearance-none bg-background border border-input pl-2.5 pr-6 py-1 text-xs text-foreground focus:outline-none focus:border-primary rounded-sm font-sans transition-colors cursor-pointer"
          >
            <option value="All">All Categories</option>
            <option value="SQLi">SQL Injection</option>
            <option value="XSS">XSS</option>
            <option value="Traversal">Path Traversal</option>
            <option value="BadBot">Bad Bots</option>
            <option value="Custom">Custom</option>
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-2.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Action filter */}
        <div className="relative">
          <select
            aria-label="Filter by action"
            value={actionFilter}
            onChange={(e) => onActionFilterChange(e.target.value)}
            className="appearance-none bg-background border border-input pl-2.5 pr-6 py-1 text-xs text-foreground focus:outline-none focus:border-primary rounded-sm font-sans transition-colors cursor-pointer"
          >
            <option value="All">All Actions</option>
            <option value="Block">Block</option>
            <option value="Allow">Allow</option>
            <option value="Log">Log</option>
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-2.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Severity filter */}
        <div className="relative">
          <select
            aria-label="Filter by severity"
            value={severityFilter}
            onChange={(e) => onSeverityFilterChange(e.target.value)}
            className="appearance-none bg-background border border-input pl-2.5 pr-6 py-1 text-xs text-foreground focus:outline-none focus:border-primary rounded-sm font-sans transition-colors cursor-pointer"
          >
            <option value="All">All Severities</option>
            <option value="Critical">Critical</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-2.5 text-muted-foreground pointer-events-none" />
        </div>

        {/* Status filter */}
        <div className="relative">
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="appearance-none bg-background border border-input pl-2.5 pr-6 py-1 text-xs text-foreground focus:outline-none focus:border-primary rounded-sm font-sans transition-colors cursor-pointer"
          >
            <option value="All">All Statuses</option>
            <option value="Enabled">Enabled</option>
            <option value="Disabled">Disabled</option>
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-2.5 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {/* Table Container */}
      <div className="border border-border overflow-x-auto rounded-sm">
        <table className="w-full text-left text-xs border-collapse font-sans">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-muted-foreground font-sans text-[11px] font-semibold select-none">
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
          <tbody className="divide-y divide-border">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-xs text-muted-foreground font-sans">
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
                    className={`cursor-pointer transition-colors ${isSelected
                        ? 'bg-primary/10 border-l-2 border-primary text-foreground'
                        : 'hover:bg-muted/50 text-foreground'
                      }`}
                  >
                    {/* Name + Icon */}
                    <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <FileCode2
                          className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'
                            }`}
                        />
                        <button type="button" onClick={e => { e.stopPropagation(); onSelect(rule.id); }} className={isSelected ? 'text-foreground font-bold' : 'text-foreground'}>
                          {rule.name}
                        </button>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap font-sans text-xs">
                      {rule.category}
                    </td>

                    {/* Target */}
                    <td className="py-2.5 px-3 text-foreground font-mono text-[11px] whitespace-nowrap">
                      {rule.target}
                    </td>

                    {/* Action Badge */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {rule.action === 'Block' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-destructive/10 text-destructive border border-destructive/30 rounded-xs">
                          BLOCK
                        </span>
                      )}
                      {rule.action === 'Log' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-muted text-foreground border border-border rounded-xs">
                          LOG
                        </span>
                      )}
                      {rule.action === 'Allow' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-primary/10 text-primary border border-primary/30 rounded-xs">
                          ALLOW
                        </span>
                      )}
                    </td>

                    {/* Severity Badge */}
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {rule.severity === 'Critical' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-destructive/10 text-destructive border border-destructive/30 uppercase rounded-xs">
                          Critical
                        </span>
                      )}
                      {rule.severity === 'High' && (
                        <span className="px-1.5 py-0.5 text-[10px] font-sans font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 uppercase rounded-xs">
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-border text-xs text-muted-foreground font-sans">
        <div className="flex items-center gap-3">
          <div>
            {total === null || total === 0 ? (
              <span>0 rules</span>
            ) : (
              <span>
                Showing <span className="font-semibold text-foreground">{rules.length > 0 ? (currentPage - 1) * pageSize + 1 : 0}</span> to{' '}
                <span className="font-semibold text-foreground">{rules.length > 0 ? (currentPage - 1) * pageSize + rules.length : 0}</span> of{' '}
                <span className="font-semibold text-foreground">{total}</span> {total === 1 ? 'rule' : 'rules'}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh rules"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-muted hover:bg-accent border border-border text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
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
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted hover:bg-accent border border-border text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
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
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted hover:bg-accent border border-border text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Previous</span>
          </button>

          <div className="flex items-center gap-1 px-1">
            {pageNumbers.map((p, idx) => {
              if (p === 'ellipsis') {
                return (
                  <span key={`ellipsis-${idx}`} className="px-1 text-muted-foreground select-none">
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
                      ? "bg-primary text-primary-foreground font-bold cursor-default"
                      : isAvailable
                        ? "bg-muted hover:bg-accent border border-border text-foreground"
                        : "bg-muted/40 border border-border/40 text-muted-foreground/40 cursor-not-allowed opacity-50"
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
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-muted hover:bg-accent border border-border text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-sm cursor-pointer"
          >
            <span className="hidden sm:inline">Next page</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
