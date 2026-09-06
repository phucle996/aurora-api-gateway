import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Download, History, Pencil, Copy, Trash2, Power } from 'lucide-react';
import type { AccessObject, AccessRuleDocument, AccessStatus, AccessChange } from '../../../lib/api/access';

interface AccessRulesTabProps {
  items: AccessObject[];
  busy: boolean;
  status: AccessStatus | null;
  onChange: (command: AccessChange) => Promise<void>;
  onSelectHistory: (item: AccessObject) => void;
}

export function AccessRulesTab({
  items,
  busy,
  status,
  onChange,
  onSelectHistory,
}: AccessRulesTabProps) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const rules = items.filter((x) => x.kind === 'rule');
  const now = Math.floor(Date.now() / 1000);

  const filtered = rules.filter((x) => {
    const d = x.document as AccessRuleDocument;
    const matchesSearch =
      `${d.name} ${d.values.join(' ')} ${d.host} ${d.description}`
        .toLowerCase()
        .includes(search.toLowerCase());

    const matchesAction = actionFilter === 'all' || d.action === actionFilter;

    let matchesType = true;
    if (typeFilter === 'disabled') {
      matchesType = !d.enabled;
    } else if (typeFilter === 'expired') {
      matchesType = Boolean(d.expires_at && d.expires_at <= now);
    } else if (typeFilter === 'temporary') {
      matchesType = d.action === 'block' && d.expires_at > now;
    } else if (typeFilter !== 'all') {
      matchesType = d.source === typeFilter;
    }

    return matchesSearch && matchesAction && matchesType;
  });

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aurora-access-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 font-sans text-xs">
      {/* Search & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card border border-border p-3 rounded-sm shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search rules, IP, host, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border border-input pl-9 pr-3 py-1.5 text-foreground rounded-sm text-xs focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Action Filter */}
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="bg-background border border-input px-2.5 py-1.5 text-foreground rounded-sm text-xs focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="all">All Actions</option>
            <option value="block">Blocklist (Block)</option>
            <option value="allow">Allowlist (Allow)</option>
            <option value="log">Log only</option>
          </select>

          {/* Type / Status Filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-background border border-input px-2.5 py-1.5 text-foreground rounded-sm text-xs focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="all">All Sources / Status</option>
            <option value="ip">IP Address</option>
            <option value="cidr">CIDR Network</option>
            <option value="country">Country / Geo</option>
            <option value="asn">ASN</option>
            <option value="group">IP Group</option>
            <option value="temporary">Temporary Bans</option>
            <option value="disabled">Disabled</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        {/* Export Button */}
        <button
          type="button"
          onClick={handleExport}
          className="inline-flex items-center gap-1.5 text-xs text-foreground bg-card hover:bg-muted border border-border px-3 py-1.5 rounded-sm cursor-pointer transition-colors shadow-xs"
        >
          <Download className="w-3.5 h-3.5 text-muted-foreground" />
          <span>Export JSON</span>
        </button>
      </div>

      {/* Access Rules Table */}
      <div className="border border-border bg-card rounded-sm overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border text-[11px] uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-3">Rule Name & Action</th>
                <th className="p-3">Source Targets</th>
                <th className="p-3">Target Scope</th>
                <th className="p-3 text-center">Priority</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs">
              {filtered.map((item) => {
                const d = item.document as AccessRuleDocument;
                const isExpired = d.expires_at > 0 && d.expires_at <= now;
                const isTemp = d.action === 'block' && d.expires_at > now;

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-muted/50 text-foreground transition-colors"
                  >
                    {/* Rule Name & Action */}
                    <td className="p-3 max-w-[220px]">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectHistory(item)}
                          className="font-semibold text-foreground hover:text-primary transition-colors text-left cursor-pointer truncate"
                          title="Click to view revision history"
                        >
                          {d.name}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        {d.action === 'block' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-destructive/10 text-destructive border border-destructive/30">
                            Block
                          </span>
                        )}
                        {d.action === 'allow' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-primary/10 text-primary border border-primary/20">
                            Allow
                          </span>
                        )}
                        {d.action === 'log' && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-900/50">
                            Log Only
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground font-mono">
                          v{item.version}
                        </span>
                      </div>
                    </td>

                    {/* Source */}
                    <td className="p-3 max-w-[240px]">
                      <div className="font-mono text-[11px] truncate text-foreground">
                        {d.values.slice(0, 3).join(', ')}
                        {d.values.length > 3 && ` +${d.values.length - 3} more`}
                      </div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                        {d.source === 'ip'
                          ? 'IP Address'
                          : d.source === 'cidr'
                          ? 'CIDR Network'
                          : d.source === 'country'
                          ? 'Geo Region'
                          : d.source === 'asn'
                          ? 'ASN Network'
                          : 'IP Group'}
                      </div>
                    </td>

                    {/* Scope */}
                    <td className="p-3">
                      <div className="font-mono text-[11px] text-foreground">
                        {d.host === '*' ? 'All Domains' : d.host}
                        {d.path_prefix && d.path_prefix !== '/' ? d.path_prefix : ''}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {d.method === '*' ? 'All Methods' : d.method} · {d.schedule}
                      </div>
                    </td>

                    {/* Priority */}
                    <td className="p-3 text-center font-mono font-bold text-foreground">
                      {d.priority}
                    </td>

                    {/* Status */}
                    <td className="p-3">
                      {!d.enabled ? (
                        <span className="inline-flex items-center gap-1.5 text-muted-foreground font-medium text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground" />
                          Disabled
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex items-center gap-1.5 text-amber-500 font-medium text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                          Expired
                        </span>
                      ) : isTemp ? (
                        <div>
                          <span className="inline-flex items-center gap-1.5 text-amber-500 font-medium text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Temporary
                          </span>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                            Until {new Date(d.expires_at * 1000).toLocaleTimeString()}
                          </p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-primary font-medium text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          Enabled
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-right pr-4">
                      <div className="flex items-center justify-end gap-2.5">
                        <Link
                          to={`/ip-access/create?edit=${item.id}`}
                          className="text-muted-foreground hover:text-primary transition-colors p-1"
                          title="Edit Rule"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Link>

                        <Link
                          to={`/ip-access/create?clone=${item.id}`}
                          className="text-muted-foreground hover:text-primary transition-colors p-1"
                          title="Clone Rule"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Link>

                        <button
                          type="button"
                          disabled={busy || !status}
                          onClick={() => onSelectHistory(item)}
                          className="text-muted-foreground hover:text-primary transition-colors p-1 cursor-pointer"
                          title="View Revision History"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          disabled={busy || !status}
                          onClick={() =>
                            onChange({
                              id: item.id,
                              kind: 'rule',
                              expected_version: item.version,
                              expected_release: status!.release_id,
                              delete: false,
                              document: { ...d, enabled: !d.enabled },
                            })
                          }
                          className={`p-1 cursor-pointer transition-colors ${
                            d.enabled
                              ? 'text-muted-foreground hover:text-amber-500'
                              : 'text-muted-foreground hover:text-primary'
                          }`}
                          title={d.enabled ? 'Disable Rule' : 'Enable Rule'}
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          disabled={busy || !status}
                          onClick={() => {
                            if (confirm(`Delete access rule "${d.name}" and apply this change across cluster?`)) {
                              onChange({
                                id: item.id,
                                kind: 'rule',
                                expected_version: item.version,
                                expected_release: status!.release_id,
                                delete: true,
                                document: null,
                              });
                            }
                          }}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1 cursor-pointer"
                          title="Delete Rule"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">
                      No matching access rules found.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Try adjusting your search criteria or add a new access rule.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
