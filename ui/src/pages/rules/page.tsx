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
  const [pageCursors, setPageCursors] = useState<Record<number, string>>({ 1: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const after = params.get('after') || '';
  const selectedParam = params.get('selected');
  const selected = selectedParam ? (rules.find(rule => rule.id === selectedParam)?.id || '') : '';

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
        if (!controller.signal.aborted) {
          setRules(records.items);
          setNext(records.next_after || '');
          setStats(counts);
          setTotal(records.total);
          if (records.next_after) {
            setPageCursors(prev => ({
              ...prev,
              [currentPage + 1]: records.next_after,
            }));
          }
        }
      } catch (error) { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : 'Load failed.'); setStats(null); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [after, search, category, action, severity, status, retry]);

  const pageSize = 50;
  const totalPages = total !== null && total > 0 ? Math.ceil(total / pageSize) : 1;
  const hasPrevPage = currentPage > 1 || (Boolean(after) && after !== '0');
  const hasNextPage = Boolean(next);

  const handleFirstPage = () => {
    setCurrentPage(1);
    setParams(p => {
      p.delete('after');
      return p;
    });
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      const prev = currentPage - 1;
      const prevCursor = pageCursors[prev] || '';
      setCurrentPage(prev);
      setParams(p => {
        if (prevCursor && prevCursor !== '0') {
          p.set('after', prevCursor);
        } else {
          p.delete('after');
        }
        return p;
      });
    } else {
      handleFirstPage();
    }
  };

  const handleNextPage = () => {
    if (next) {
      const nextPage = currentPage + 1;
      setPageCursors(prev => ({ ...prev, [nextPage]: next }));
      setCurrentPage(nextPage);
      setParams(p => {
        p.set('after', next);
        return p;
      });
    }
  };

  const handlePageSelect = (page: number) => {
    if (page === 1) {
      handleFirstPage();
    } else if (pageCursors[page]) {
      setCurrentPage(page);
      setParams(p => {
        p.set('after', pageCursors[page]);
        return p;
      });
    }
  };

  const handleRefresh = () => {
    setRetry(r => r + 1);
  };

  const resetPagination = () => {
    setPageCursors({ 1: '' });
    setCurrentPage(1);
  };

  const rows: RulesTableRow[] = rules.map(rule => ({
    id: rule.id, name: rule.name, category: Object.keys(groups).find(label => groups[label] === rule.group) || rule.group,
    target: rule.schema_version === 2 ? 'Saved conditions' : rule.path,
    action: rule.action === 'allow' ? 'Allow' : rule.action === 'block' ? 'Block' : 'Log',
    severity: rule.severity === 'critical' ? 'Critical' : rule.severity === 'high' ? 'High' : rule.severity === 'medium' ? 'Medium' : 'Low',
    lastUpdated: rule.updated_at, status: rule.enabled ? 'Enabled' : 'Disabled',
  }));
  return (
    <div className="p-6 w-full space-y-4 font-sans">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight font-sans text-foreground">Security Rules</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Saved definitions and immutable revisions. Enabled does not mean deployed.</p>
        </div>
        <Link to="/rules/create" className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 flex gap-2 items-center text-xs font-semibold rounded-sm shadow-xs transition-colors">
          <Plus className="w-4 h-4" />Create Rule
        </Link>
      </div>
      {location.state?.createdId === selected && (
        <p role="status" className="text-primary font-medium">Rule #{selected} saved successfully. No NGINX deployment was performed.</p>
      )}
      <RulesStats stats={stats} />
      {error && (
        <div role="alert" className="text-rose-300">
          {error} <button onClick={handleRefresh}>Retry</button>
        </div>
      )}
      {loading && <p role="status" className="text-xs text-slate-500 dark:text-slate-400">Loading saved rules…</p>}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <RulesTable
          rules={rows}
          total={total}
          selectedId={selected}
          onSelect={id => setParams(p => {
            if (p.get('selected') === id) {
              p.delete('selected');
            } else {
              p.set('selected', id);
            }
            return p;
          })}
          searchQuery={search}
          onSearchChange={value => { setSearch(value); resetPagination(); setParams({}); }}
          categoryFilter={category}
          onCategoryFilterChange={value => { setCategory(value); resetPagination(); setParams({}); }}
          actionFilter={action}
          onActionFilterChange={value => { setAction(value); resetPagination(); setParams({}); }}
          severityFilter={severity}
          onSeverityFilterChange={value => { setSeverity(value); resetPagination(); setParams({}); }}
          statusFilter={status}
          onStatusFilterChange={value => { setStatus(value); resetPagination(); setParams({}); }}
          currentPage={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          hasNextPage={hasNextPage}
          hasPrevPage={hasPrevPage}
          loading={loading}
          knownPages={Object.keys(pageCursors).map(Number)}
          onFirstPage={handleFirstPage}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
          onPageSelect={handlePageSelect}
          onRefresh={handleRefresh}
        />
        {!loading && !error && selected && (
          <SavedRuleDetail
            key={selected}
            id={selected}
            onChanged={handleRefresh}
            onClose={() => setParams(p => { p.delete('selected'); return p; })}
          />
        )}
      </div>
    </div>
  );
}
