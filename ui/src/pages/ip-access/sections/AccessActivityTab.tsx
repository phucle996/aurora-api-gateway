import React, { useState, useMemo } from 'react';
import {
  Activity,
  Search,
  AlertTriangle,
  ShieldAlert,
  Clock,
  Server,
  Copy,
  Check,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { AccessActivity } from '../../../lib/api/access';

interface AccessActivityTabProps {
  activity: AccessActivity[];
}

type SortField = 'timestamp' | 'ip' | 'action' | 'node_id' | 'rule_id' | 'signals';
type SortDirection = 'asc' | 'desc';

export function AccessActivityTab({ activity }: AccessActivityTabProps) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [signalFilter, setSignalFilter] = useState('all');
  const [copiedIp, setCopiedIp] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const filtered = useMemo(() => {
    return activity.filter((item) => {
      const matchesSearch =
        item.ip.toLowerCase().includes(search.toLowerCase()) ||
        item.node_id.toLowerCase().includes(search.toLowerCase()) ||
        String(item.rule_id).includes(search);

      const matchesAction =
        actionFilter === 'all' || item.action.toLowerCase() === actionFilter.toLowerCase();

      let matchesSignal = true;
      if (signalFilter === 'alert') {
        matchesSignal = item.alert;
      } else if (signalFilter === 'reputation') {
        matchesSignal = item.reputation;
      }

      return matchesSearch && matchesAction && matchesSignal;
    });
  }, [activity, search, actionFilter, signalFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'timestamp': {
          const timeA = new Date(a.created_at).getTime() || 0;
          const timeB = new Date(b.created_at).getTime() || 0;
          cmp = timeA - timeB;
          break;
        }
        case 'ip': {
          cmp = a.ip.localeCompare(b.ip, undefined, { numeric: true });
          break;
        }
        case 'action': {
          cmp = a.action.localeCompare(b.action);
          break;
        }
        case 'node_id': {
          cmp = a.node_id.localeCompare(b.node_id, undefined, { numeric: true });
          break;
        }
        case 'rule_id': {
          if (a.rule_id !== b.rule_id) {
            cmp = a.rule_id - b.rule_id;
          } else {
            cmp = a.release_id - b.release_id;
          }
          break;
        }
        case 'signals': {
          const scoreA = (a.risk_score || 0) + (a.alert ? 1000 : 0);
          const scoreB = (b.risk_score || 0) + (b.alert ? 1000 : 0);
          cmp = scoreA - scoreB;
          break;
        }
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'timestamp' || field === 'signals' ? 'desc' : 'asc');
    }
  };

  const handleCopyIp = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 1500);
  };

  const getActionBadge = (action: string) => {
    const upper = action.toUpperCase();
    if (upper === 'BLOCK') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold bg-destructive/10 text-destructive border border-destructive/30">
          BLOCK
        </span>
      );
    }
    if (upper === 'ALLOW') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/20">
          ALLOW
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-900/60">
        {upper}
      </span>
    );
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-card border border-border p-4 rounded-xs shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Access Activity Log</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Real-time audit log of access decisions across edge nodes. Alerts and reputation flags are derived from the rule revision that evaluated the request.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search IP, node, rule..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border border-input pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors rounded-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Action Filter */}
          <div className="relative">
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="bg-background border border-input text-foreground px-2.5 py-1.5 text-xs rounded-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="all">All Actions</option>
              <option value="block">Block</option>
              <option value="allow">Allow</option>
              <option value="log">Log</option>
            </select>
          </div>

          {/* Signal Filter */}
          <div className="relative">
            <select
              value={signalFilter}
              onChange={(e) => setSignalFilter(e.target.value)}
              className="bg-background border border-input text-foreground px-2.5 py-1.5 text-xs rounded-xs focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="all">All Signals</option>
              <option value="alert">Alerts Only</option>
              <option value="reputation">Risk Scored Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden border border-border bg-card rounded-xs shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground border-b border-border select-none">
              <tr>
                <th className="py-2.5 px-4 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('timestamp')}
                    className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors group"
                  >
                    <span>Timestamp</span>
                    {sortField === 'timestamp' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-4 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('ip')}
                    className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors group"
                  >
                    <span>Client IP</span>
                    {sortField === 'ip' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-4 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('action')}
                    className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors group"
                  >
                    <span>Action</span>
                    {sortField === 'action' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-4 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('node_id')}
                    className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors group"
                  >
                    <span>Node</span>
                    {sortField === 'node_id' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-4 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('rule_id')}
                    className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors group"
                  >
                    <span>Rule & Release</span>
                    {sortField === 'rule_id' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
                    )}
                  </button>
                </th>
                <th className="py-2.5 px-4 font-semibold">
                  <button
                    type="button"
                    onClick={() => handleSort('signals')}
                    className="flex items-center gap-1.5 cursor-pointer hover:text-foreground transition-colors group"
                  >
                    <span>Security Signals</span>
                    {sortField === 'signals' ? (
                      sortDirection === 'asc' ? (
                        <ArrowUp className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <ArrowDown className="w-3.5 h-3.5 text-primary" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-muted-foreground/60 group-hover:text-muted-foreground" />
                    )}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((e, i) => (
                <tr
                  key={i}
                  className="hover:bg-muted/50 transition-colors text-foreground"
                >
                  {/* Timestamp */}
                  <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span>{new Date(e.created_at).toLocaleString()}</span>
                    </div>
                  </td>

                  {/* Client IP */}
                  <td className="py-3 px-4 font-mono text-xs text-foreground font-medium whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{e.ip}</span>
                      <button
                        onClick={() => handleCopyIp(e.ip)}
                        title="Copy IP"
                        className="text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer"
                      >
                        {copiedIp === e.ip ? (
                          <Check className="w-3 h-3 text-primary" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </td>

                  {/* Action */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    {getActionBadge(e.action)}
                  </td>

                  {/* Edge Node */}
                  <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Server className="w-3 h-3 text-muted-foreground" />
                      <span>{e.node_id}</span>
                    </div>
                  </td>

                  {/* Rule & Release */}
                  <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                    <span className="text-primary font-medium">
                      Rule #{e.rule_id}
                    </span>
                    <span className="text-muted-foreground mx-1.5">/</span>
                    <span>Release #{e.release_id}</span>
                  </td>

                  {/* Signals */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {e.alert && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Alert Triggered</span>
                        </span>
                      )}
                      {e.reputation && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-mono font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          <ShieldAlert className="w-3 h-3" />
                          <span>Risk: {e.risk_score}</span>
                        </span>
                      )}
                      {!e.alert && !e.reputation && (
                        <span className="text-[11px] text-muted-foreground font-mono">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div className="p-8 text-center text-muted-foreground text-xs">
            No matching access events found.
          </div>
        )}
      </div>
    </div>
  );
}
