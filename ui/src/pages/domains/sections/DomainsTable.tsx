import React, { useState } from 'react';
import {
  Lock,
  Shield,
  ShieldCheck,
  FileKey,
  AlertTriangle,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Trash2,
  ExternalLink,
  Eye,
  Check,
} from 'lucide-react';
import type { DomainItem, TlsType } from '../types';

interface DomainsTableProps {
  domains: DomainItem[];
  selectedDomainId: string | null;
  onSelectDomain: (domain: DomainItem) => void;
  onEditDomain: (domain: DomainItem) => void;
  onDeleteDomain: (domain: DomainItem) => void;
  onToggleStatus: (domain: DomainItem) => void;
}

export function getTagStyle(tag: string): string {
  switch (tag.toLowerCase()) {
    case 'api':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40';
    case 'prod':
      return 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40';
    case 'admin':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40';
    case 'internal':
      return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40';
    case 'public':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40';
    case 'staging':
      return 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/40';
    case 'auth':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40';
    case 'secure':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40';
    case 'static':
      return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/40';
    case 'cdn':
      return 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/40';
    case 'blog':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/40';
    case 'dev':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40';
    case 'b2b':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/40';
    case 'partner':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40';
    case 'shop':
      return 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40';
    case 'ecommerce':
      return 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/40 dark:text-pink-300 dark:border-pink-800/40';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

export function renderTlsBadge(tlsType: TlsType) {
  switch (tlsType) {
    case "Let's Encrypt":
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50 shadow-xs">
          <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Let's Encrypt</span>
        </span>
      );
    case 'Custom Cert':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50 shadow-xs">
          <FileKey className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
          <span>Custom Cert</span>
        </span>
      );
    case 'mTLS':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/50 shadow-xs">
          <ShieldCheck className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />
          <span>mTLS</span>
        </span>
      );
    case 'Self-signed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50 shadow-xs">
          <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Self-signed</span>
        </span>
      );
  }
}

export function DomainsTable({
  domains,
  selectedDomainId,
  onSelectDomain,
  onEditDomain,
  onDeleteDomain,
  onToggleStatus,
}: DomainsTableProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const total = domains.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIndex = (page - 1) * pageSize;
  const paginatedDomains = domains.slice(startIndex, startIndex + pageSize);

  const handleSelectAll = () => {
    if (selectedIds.length === paginatedDomains.length && paginatedDomains.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(paginatedDomains.map((d) => d.id));
    }
  };

  const handleToggleRow = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg shadow-xs overflow-hidden flex flex-col font-sans transition-all">
      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-muted-foreground font-medium select-none">
              <th className="w-10 px-3 py-3 text-center">
                <input
                  type="checkbox"
                  checked={
                    paginatedDomains.length > 0 &&
                    selectedIds.length === paginatedDomains.length
                  }
                  onChange={handleSelectAll}
                  aria-label="Select all domains"
                  className="rounded border-border text-primary focus:ring-primary/30 cursor-pointer accent-primary"
                />
              </th>
              <th className="px-4 py-3 font-semibold text-foreground">Domain</th>
              <th className="px-4 py-3 font-semibold text-foreground">Status</th>
              <th className="px-4 py-3 font-semibold text-foreground">TLS / Security</th>
              <th className="px-4 py-3 font-semibold text-foreground">Upstream</th>
              <th className="px-3 py-3 text-center font-semibold text-foreground">Rules</th>
              <th className="px-4 py-3 font-semibold text-foreground">Tags</th>
              <th className="px-4 py-3 font-semibold text-foreground">Updated At</th>
              <th className="w-12 px-3 py-3 text-center font-semibold text-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {paginatedDomains.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  No domains match the current criteria.
                </td>
              </tr>
            ) : (
              paginatedDomains.map((item) => {
                const isSelected = selectedDomainId === item.id;
                const isChecked = selectedIds.includes(item.id);

                return (
                  <tr
                    key={item.id}
                    onClick={() => onSelectDomain(item)}
                    className={`group cursor-pointer transition-all duration-150 hover:bg-muted/50 ${
                      isSelected
                        ? 'bg-blue-50/60 dark:bg-blue-950/25 border-l-2 border-l-blue-600'
                        : 'border-l-2 border-l-transparent'
                    }`}
                  >
                    {/* Checkbox */}
                    <td
                      className="w-10 px-3 py-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => handleToggleRow(item.id, e as unknown as React.MouseEvent)}
                        aria-label={`Select domain ${item.domain}`}
                        className="rounded border-border text-primary focus:ring-primary/30 cursor-pointer accent-primary"
                      />
                    </td>

                    {/* Domain & Subdomain */}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-semibold text-[13px] text-foreground group-hover:text-primary transition-colors flex items-center gap-1.5">
                          {item.domain}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {item.rootDomain}
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-2.5">
                      {item.status === 'Active' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                          </span>
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                          <span className="h-2 w-2 rounded-full bg-slate-400"></span>
                          Inactive
                        </span>
                      )}
                    </td>

                    {/* TLS / Security */}
                    <td className="px-4 py-2.5">
                      {renderTlsBadge(item.tlsType)}
                    </td>

                    {/* Upstream */}
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[11px] text-muted-foreground bg-muted/60 px-2 py-1 rounded border border-border/60">
                        {item.upstream}
                      </span>
                    </td>

                    {/* Rules count */}
                    <td className="px-3 py-2.5 text-center">
                      <span className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                        {item.rulesCount}
                      </span>
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        {item.tags.map((tag) => (
                          <span
                            key={tag}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${getTagStyle(
                              tag
                            )}`}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Updated At */}
                    <td className="px-4 py-2.5 text-muted-foreground text-[11px] whitespace-nowrap">
                      {item.updatedAt}
                    </td>

                    {/* Actions Menu */}
                    <td
                      className="w-12 px-3 py-2.5 text-center relative"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setMenuOpenId(menuOpenId === item.id ? null : item.id)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Actions"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>

                      {/* Dropdown Menu */}
                      {menuOpenId === item.id && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setMenuOpenId(null)}
                          />
                          <div className="absolute right-3 top-9 z-30 w-44 bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1 text-left animate-in fade-in-50 zoom-in-95">
                            <button
                              type="button"
                              onClick={() => {
                                onSelectDomain(item);
                                setMenuOpenId(null);
                              }}
                              className="w-full px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-muted cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                              <span>View Details</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onEditDomain(item);
                                setMenuOpenId(null);
                              }}
                              className="w-full px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-muted cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                              <span>Edit Domain</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                onToggleStatus(item);
                                setMenuOpenId(null);
                              }}
                              className="w-full px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-muted cursor-pointer"
                            >
                              <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                              <span>
                                {item.status === 'Active' ? 'Deactivate' : 'Activate'}
                              </span>
                            </button>
                            <div className="my-1 border-t border-border" />
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteDomain(item);
                                setMenuOpenId(null);
                              }}
                              className="w-full px-3 py-1.5 text-xs flex items-center gap-2 text-destructive hover:bg-destructive/10 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Domain</span>
                            </button>
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-4 py-3 border-t border-border bg-card flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground select-none">
        <div>
          Showing <span className="font-semibold text-foreground">{startIndex + 1}</span>–
          <span className="font-semibold text-foreground">
            {Math.min(startIndex + pageSize, total)}
          </span>{' '}
          of <span className="font-semibold text-foreground">{total}</span> domains
        </div>

        <div className="flex items-center gap-2">
          {/* Prev button */}
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Page numbers */}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPage(p)}
              className={`w-7 h-7 rounded text-xs font-medium transition-colors cursor-pointer ${
                page === p
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'border border-border hover:bg-muted text-foreground'
              }`}
            >
              {p}
            </button>
          ))}

          {/* Next button */}
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="p-1.5 rounded border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Page Size Selector */}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="ml-2 bg-background border border-input text-foreground text-xs rounded px-2 py-1 focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value={5}>5 / page</option>
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
          </select>
        </div>
      </div>
    </div>
  );
}
