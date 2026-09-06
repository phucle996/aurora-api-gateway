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
    <div className={`${selectedId ? 'xl:col-span-7' : 'xl:col-span-12'} bg-card border border-border p-4 space-y-3 shadow-xs rounded-sm transition-all duration-200`}>
      {/* Table Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-sans font-semibold text-slate-900 dark:text-white uppercase tracking-wider">
            Policies
          </h2>
          <span className="px-1.5 py-0.2 bg-muted text-[11px] font-sans text-foreground rounded-xs">
            {policies.length}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap font-sans">
          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filter policies..."
              className="bg-muted border border-input pl-8 pr-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary rounded-sm transition-colors font-sans w-44"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <select
              value={statusFilter}
              onChange={(e) => onStatusFilterChange(e.target.value)}
              className="appearance-none bg-muted border border-input pl-2.5 pr-6 py-1 text-xs text-foreground focus:outline-none focus:border-primary rounded-sm transition-colors font-sans cursor-pointer"
            >
              <option>All Statuses</option>
              <option>Published</option>
              <option>Draft</option>
              <option>Disabled</option>
            </select>
            <ChevronDown className="w-3 h-3 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="border border-border overflow-x-auto rounded-sm">
        <table className="w-full text-left border-collapse text-xs font-sans">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-xs font-sans text-muted-foreground select-none">
              <th className="py-2.5 px-3">POLICY NAME</th>
              <th className="py-2.5 px-3">SCOPE</th>
              <th className="py-2.5 px-3">MODE</th>
              <th className="py-2.5 px-3">RULE SETS</th>
              <th className="py-2.5 px-3">LAST UPDATED</th>
              <th className="py-2.5 px-3">STATUS</th>
              <th className="py-2.5 px-2 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {policies.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-xs text-slate-400 dark:text-slate-500 font-sans">
                  No policies found.
                </td>
              </tr>
            ) : (
              policies.map((p) => {
                const isSelected = p.id === selectedId;
                return (
                  <tr
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-primary/10 border-l-2 border-primary text-foreground'
                      : 'hover:bg-muted/60 text-muted-foreground'
                  }`}
                >
                  <td className="py-2.5 px-3 font-medium whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <FileText
                        className={`w-3.5 h-3.5 shrink-0 ${
                          isSelected ? 'text-primary' : 'text-muted-foreground'
                        }`}
                      />
                      <span className={isSelected ? 'text-foreground font-bold' : 'text-foreground'}>
                        {p.name}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground font-mono text-[11px] whitespace-nowrap">
                    {p.scope}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-sans font-bold border uppercase rounded-xs ${
                        p.mode === 'Block'
                          ? 'bg-rose-50 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          : p.mode === 'Detect'
                          ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                          : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      }`}
                    >
                      {p.mode}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-foreground font-sans text-xs whitespace-nowrap">
                    {p.ruleSetsCount} rules
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground font-sans text-xs whitespace-nowrap">
                    {p.lastUpdated}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-sans font-bold border uppercase rounded-xs ${
                        p.status === 'Published'
                          ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-700'
                          : p.status === 'Draft'
                          ? 'bg-muted text-muted-foreground border-border'
                          : 'bg-muted/50 text-muted-foreground border-border'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-right">
                    <button
                      type="button"
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-xs"
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
            }))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
