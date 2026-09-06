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
    <div className="bg-card border border-border p-4 space-y-3 font-sans shadow-sm">
      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-2 font-sans">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search rules by name, path, host..."
            className="w-full bg-background border border-input pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* Status Dropdown */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="appearance-none bg-background border border-input pl-3 pr-7 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary transition-colors cursor-pointer"
          >
            <option>All Status</option>
            <option>Active</option>
            <option>Disabled</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Types Dropdown */}
        <div className="relative">
          <select
            value={typeFilter}
            onChange={(e) => onTypeFilterChange(e.target.value)}
            className="appearance-none bg-background border border-input pl-3 pr-7 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary transition-colors cursor-pointer"
          >
            <option>All Types</option>
            <option>Request</option>
            <option>Connection</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Hosts Dropdown */}
        <div className="relative">
          <select
            value={hostFilter}
            onChange={(e) => onHostFilterChange(e.target.value)}
            className="appearance-none bg-background border border-input pl-3 pr-7 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary transition-colors cursor-pointer"
          >
            <option>All Hosts</option>
            <option>api.example.com</option>
            <option>app.example.com</option>
            <option>admin.aurora.local</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Reset */}
        <button
          type="button"
          onClick={onResetFilters}
          className="flex items-center gap-1.5 bg-muted hover:bg-muted/80 text-foreground border border-border px-3 py-1.5 text-xs transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Reset</span>
        </button>
      </div>

      {/* Table Container */}
      <div className="border border-border overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse font-sans">
          <thead>
            <tr className="bg-muted/40 border-b border-border text-muted-foreground font-sans text-xs select-none">
              <th className="py-2.5 px-3 w-8">
                <input
                  type="checkbox"
                  checked={
                    rules.length > 0 && selectedIds.length === rules.length
                  }
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="w-3.5 h-3.5 border-border bg-background text-primary focus:ring-0 cursor-pointer accent-primary"
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
          <tbody className="divide-y divide-border">
            {rules.map((rule) => {
              const isChecked = selectedIds.includes(rule.id);
              return (
                <tr
                  key={rule.id}
                  className={`transition-colors ${
                    isChecked
                      ? 'bg-primary/10 border-l-2 border-primary text-foreground'
                      : 'hover:bg-muted/50 text-foreground'
                  }`}
                >
                  <td className="py-2.5 px-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleToggleRow(rule.id)}
                      className="w-3.5 h-3.5 border-border bg-background text-primary focus:ring-0 cursor-pointer accent-primary"
                    />
                  </td>

                  {/* Name */}
                  <td className="py-2.5 px-3 font-semibold text-foreground whitespace-nowrap">
                    {rule.name}
                  </td>

                  {/* Type */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                      {rule.type}
                    </span>
                  </td>

                  {/* Key */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    {rule.key}
                  </td>

                  {/* Limit */}
                  <td className="py-2.5 px-3 font-mono text-[11px] font-bold text-foreground whitespace-nowrap">
                    {rule.limit}
                  </td>

                  {/* Window */}
                  <td className="py-2.5 px-3 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    {rule.window}
                  </td>

                  {/* Action Badge */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {rule.action === 'BLOCK' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/20 uppercase">
                        BLOCK
                      </span>
                    )}
                    {rule.action === 'RATE LIMIT' && (
                      <span className="px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 uppercase">
                        RATE LIMIT
                      </span>
                    )}
                  </td>

                  {/* Scope */}
                  <td className="py-2.5 px-3 text-muted-foreground font-mono text-[11px] whitespace-nowrap">
                    {rule.scope}
                  </td>

                  {/* Status */}
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 inline-block" />
                      <span>{rule.status}</span>
                    </span>
                  </td>

                  {/* Description */}
                  <td className="py-2.5 px-3 text-muted-foreground text-[11px] max-w-[200px] truncate">
                    {rule.description}
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        title="Edit Rule"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        title="Clone Rule"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        className="p-1 text-muted-foreground hover:text-destructive hover:bg-muted transition-colors cursor-pointer"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 text-xs text-muted-foreground font-sans">
        <div>
          Showing 1 to {rules.length} of 18 rules
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 bg-card border border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className="px-2 py-0.5 bg-primary text-primary-foreground font-bold"
          >
            1
          </button>
          <button
            type="button"
            className="px-2 py-0.5 bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            2
          </button>
          <button
            type="button"
            className="px-2 py-0.5 bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            3
          </button>
          <button
            type="button"
            className="p-1 bg-card border border-border text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
