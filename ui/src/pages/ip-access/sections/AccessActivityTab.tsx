import React, { useState } from 'react';
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
  Filter,
} from 'lucide-react';
import type { AccessActivity } from '../../../lib/api/access';

interface AccessActivityTabProps {
  activity: AccessActivity[];
}

export function AccessActivityTab({ activity }: AccessActivityTabProps) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [signalFilter, setSignalFilter] = useState('all');
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const filtered = activity.filter((item) => {
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

  const handleCopyIp = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(ip);
    setTimeout(() => setCopiedIp(null), 1500);
  };

  const getActionBadge = (action: string) => {
    const upper = action.toUpperCase();
    if (upper === 'BLOCK') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/60">
          BLOCK
        </span>
      );
    }
    if (upper === 'ALLOW') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/60">
          ALLOW
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-xs text-[10px] font-mono font-bold bg-cyan-50 dark:bg-cyan-950/50 text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-900/60">
        {upper}
      </span>
    );
  };

  return (
    <div className="space-y-4 font-sans">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-4 rounded-xs shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <span>Access Activity Log</span>
              <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900/50">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                LIVE
              </span>
            </h2>
            <span className="px-2 py-0.5 text-[11px] font-mono font-medium rounded-full bg-slate-100 dark:bg-[#152030] text-slate-600 dark:text-slate-300">
              {activity.length} sampled events
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time audit log of access decisions across edge nodes. Alerts and reputation flags are derived from the rule revision that evaluated the request.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search IP, node, rule..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-blue-500 transition-colors rounded-xs"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
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
              className="bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] text-slate-900 dark:text-white px-2.5 py-1.5 text-xs rounded-xs focus:outline-none focus:border-blue-500 cursor-pointer"
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
              className="bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] text-slate-900 dark:text-white px-2.5 py-1.5 text-xs rounded-xs focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="all">All Signals</option>
              <option value="alert">Alerts Only</option>
              <option value="reputation">Risk Scored Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden border border-slate-200 dark:border-[#172338] bg-white dark:bg-[#080E18] rounded-xs shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-[#0B1320] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-[#172338]">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                <th className="py-2.5 px-4 font-semibold">Client IP</th>
                <th className="py-2.5 px-4 font-semibold">Action</th>
                <th className="py-2.5 px-4 font-semibold">Edge Node</th>
                <th className="py-2.5 px-4 font-semibold">Rule & Release</th>
                <th className="py-2.5 px-4 font-semibold">Security Signals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#172338]">
              {filtered.map((e, i) => (
                <tr
                  key={i}
                  className="hover:bg-slate-50/80 dark:hover:bg-[#0F1A2E]/40 transition-colors text-slate-700 dark:text-slate-300"
                >
                  {/* Timestamp */}
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-400" />
                      <span>{new Date(e.created_at).toLocaleString()}</span>
                    </div>
                  </td>

                  {/* Client IP */}
                  <td className="py-3 px-4 font-mono text-xs text-slate-900 dark:text-white font-medium whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span>{e.ip}</span>
                      <button
                        onClick={() => handleCopyIp(e.ip)}
                        title="Copy IP"
                        className="text-slate-400 hover:text-slate-200 transition-colors p-0.5 cursor-pointer"
                      >
                        {copiedIp === e.ip ? (
                          <Check className="w-3 h-3 text-emerald-400" />
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
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <Server className="w-3 h-3 text-slate-400" />
                      <span>{e.node_id}</span>
                    </div>
                  </td>

                  {/* Rule & Release */}
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    <span className="text-blue-600 dark:text-blue-400 font-medium">
                      Rule #{e.rule_id}
                    </span>
                    <span className="text-slate-400 dark:text-slate-600 mx-1.5">/</span>
                    <span>Release #{e.release_id}</span>
                  </td>

                  {/* Signals */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {e.alert && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Alert Triggered</span>
                        </span>
                      )}
                      {e.reputation && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-mono font-medium bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-900/60">
                          <ShieldAlert className="w-3 h-3" />
                          <span>Risk: {e.risk_score}</span>
                        </span>
                      )}
                      {!e.alert && !e.reputation && (
                        <span className="text-[11px] text-slate-400 font-mono">—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="p-8 text-center text-slate-500 dark:text-slate-400 text-xs">
            No matching access events found.
          </div>
        )}
      </div>
    </div>
  );
}
