import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { RulesStats, type RulesStatsData } from './sections/RulesStats';
import { RulesTable, type RulesTableRow } from './sections/RulesTable';
import { SavedRuleDetail } from './sections/SavedRuleDetail';
import { getAuthToken } from '../../lib/fetcher';

interface ListedRule {
  id: string; version: number; name: string; group: string; action: 'allow' | 'block' | 'log';
  severity: 'low' | 'medium' | 'high' | 'critical'; path: string; enabled: boolean;
  updated_at: string; schema_version: number; runtime_ready: boolean;
}
const groups: Record<string, string> = { Custom: 'custom', 'SQL Injection': 'sqli', XSS: 'xss', 'Path Traversal': 'traversal', 'Bot Detection': 'bot', 'Sensitive Endpoint': 'endpoint', Authentication: 'authentication' };

export default function RulesPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [rules, setRules] = useState<ListedRule[]>([]);
  const [stats, setStats] = useState<RulesStatsData | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All Categories');
  const [action, setAction] = useState('All Actions');
  const [severity, setSeverity] = useState('All Severities');
  const [status, setStatus] = useState('All Statuses');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const after = params.get('after') || '';
  const selected = rules.find(rule => rule.id === params.get('selected'))?.id || rules[0]?.id || '';

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setRules([]); setNext(''); setStats(null); setTotal(null);
    const query = new URLSearchParams({ limit: '50', search });
    if (after) query.set('after', after);
    if (groups[category]) query.set('group', groups[category]);
    if (action !== 'All Actions') query.set('action', action.toLowerCase());
    if (severity !== 'All Severities') query.set('severity', severity.toLowerCase());
    if (status !== 'All Statuses') query.set('enabled', status === 'Enabled' ? 'true' : 'false');
    const authToken = getAuthToken();
    const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    (async () => {
      try {
        const [list, totals] = await Promise.all([
          fetch('/api/v1/rules?' + query, { headers: authHeaders, credentials: 'same-origin', signal: controller.signal }),
          fetch('/api/v1/rules/stats', { headers: authHeaders, credentials: 'same-origin', signal: controller.signal }),
        ]);
        if (!list.ok || !totals.ok) throw new Error(`Cannot load Rules (${list.status}/${totals.status}).`);
        const records = await list.json(); const counts = await totals.json();
        if (!Array.isArray(records.items) || !Number.isSafeInteger(records.total) || records.total < 0 ||
          !['total', 'enabled', 'log', 'block'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0) ||
          typeof counts.history_available !== 'boolean' || typeof counts.as_of !== 'string' || typeof counts.comparison_before !== 'string' ||
          !['total_delta', 'enabled_delta', 'log_delta', 'block_delta'].every(key => counts[key] === null || Number.isSafeInteger(counts[key]))) {
          throw new Error('Invalid Rules API response. No statistics will be displayed.');
        }
        if (!controller.signal.aborted) { setRules(records.items); setNext(records.next_after || ''); setStats(counts); setTotal(records.total); }
      } catch (error) { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Load failed.'); setStats(null); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [after, search, category, action, severity, status, retry]);

  const rows: RulesTableRow[] = rules.map(rule => ({
    id: rule.id, name: rule.name, category: Object.keys(groups).find(label => groups[label] === rule.group) || rule.group,
    target: rule.schema_version === 2 ? 'Saved conditions' : rule.path,
    action: rule.action === 'allow' ? 'Allow' : rule.action === 'block' ? 'Block' : 'Log',
    severity: rule.severity === 'critical' ? 'Critical' : rule.severity === 'high' ? 'High' : rule.severity === 'medium' ? 'Medium' : 'Low',
    lastUpdated: rule.updated_at, status: rule.enabled ? 'Enabled' : 'Disabled',
  }));
  return (
    <div className="p-6 space-y-4 font-sans">
      <div className="flex items-center justify-between border-b border-[#172338] pb-3">
        <div>
          <h1 className="text-xl font-bold font-mono">Security Rules</h1>
          <p className="text-xs text-slate-400">Saved definitions and immutable revisions. Enabled does not mean deployed.</p>
        </div>
        <Link to="/rules/create" className="bg-emerald-600 px-4 py-2 flex gap-2 items-center text-xs">
          <Plus className="w-4 h-4" />Create Rule
        </Link>
      </div>
      {location.state?.createdId === selected && (
        <p role="status" className="text-emerald-300">Rule #{selected} saved successfully. No NGINX deployment was performed.</p>
      )}
      <RulesStats stats={stats} />
      {error && (
        <div role="alert" className="text-rose-300">
          {error} <button onClick={() => setRetry(retry + 1)}>Retry</button>
        </div>
      )}
      {loading && <p role="status">Loading saved rules…</p>}
      {!loading && !error && rules.length === 0 && <p>No saved rules match these filters.</p>}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <RulesTable
          rules={rows}
          total={total}
          selectedId={selected}
          onSelect={id => setParams(p => { p.set('selected', id); return p; })}
          searchQuery={search}
          onSearchChange={value => { setSearch(value); setParams({}); }}
          categoryFilter={category}
          onCategoryFilterChange={value => { setCategory(value); setParams({}); }}
          actionFilter={action}
          onActionFilterChange={value => { setAction(value); setParams({}); }}
          severityFilter={severity}
          onSeverityFilterChange={value => { setSeverity(value); setParams({}); }}
          statusFilter={status}
          onStatusFilterChange={value => { setStatus(value); setParams({}); }}
        />
        {!loading && !error && <SavedRuleDetail id={selected} />}
      </div>
      <div className="flex gap-4 text-sm">
        <button disabled={!after || loading} onClick={() => setParams({})}>First page</button>
        <button disabled={!next || loading} onClick={() => setParams({ after: next })}>Next page</button>
        <button disabled={loading} onClick={() => setRetry(retry + 1)}>Refresh</button>
      </div>
    </div>
  );
}
