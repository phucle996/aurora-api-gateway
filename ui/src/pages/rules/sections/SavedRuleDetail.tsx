import { useEffect, useState } from 'react';
import { getAuthToken } from '../../../lib/fetcher';

interface SavedDetail {
  id: string; version: number; schema_version: number; name: string; description: string;
  group: string; action: string; severity: string; score: number; priority: number;
  enabled: boolean; updated_at: string; runtime_ready: boolean; runtime_issues: string[];
  logic_mode: string; conditions: { field: string; operator: string; value: string; header_name: string }[];
  source_ip: string; host_domain: string; path_prefix: string; http_method: string;
  response_code: number | null; custom_response: string; log_event: boolean; add_to_reputation: boolean;
}
interface SavedHistory { version: number; action: string; enabled: boolean; actor: string; updated_at: string }

export function SavedRuleDetail({ id }: { id: string }) {
  const [detail, setDetail] = useState<SavedDetail | null>(null);
  const [history, setHistory] = useState<SavedHistory[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!id) { setDetail(null); return; }
    const controller = new AbortController(); setDetail(null); setHistory([]); setError('');
    const authToken = getAuthToken();
    const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    (async () => {
      try {
        const [record, audit] = await Promise.all([
          fetch('/api/v1/rules/' + encodeURIComponent(id), { headers: authHeaders, credentials: 'same-origin', signal: controller.signal }),
          fetch('/api/v1/rules/' + encodeURIComponent(id) + '/history?limit=10', { headers: authHeaders, credentials: 'same-origin', signal: controller.signal }),
        ]);
        if (!record.ok || !audit.ok) throw new Error(`Cannot load saved rule (${record.status}/${audit.status}).`);
        const value = await record.json(); const revisions = await audit.json();
        if (!controller.signal.aborted) { setDetail(value); setHistory(revisions.items); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Read failed.'); }
    })();
    return () => controller.abort();
  }, [id, retry]);
  return <aside className="xl:col-span-5 bg-[#0B1320] border border-[#172338] p-4 text-xs space-y-4 select-text" aria-label="Saved rule detail">
    {error ? <div role="alert">{error} <button onClick={() => setRetry(retry + 1)}>Retry read</button></div> :
      !id ? <p>Select a saved rule.</p> : !detail ? <p role="status">Loading saved revision…</p> : <>
      <h2 className="text-base text-white font-semibold">{detail.name}</h2>
      <p>Rule #{detail.id} · revision {detail.version} · {detail.enabled ? 'Enabled definition' : 'Disabled definition'}</p>
      <p className="text-cyan-300">Saved definition — this view does not assert deployment or NGINX activation.</p>
      <p className={detail.runtime_ready ? 'text-emerald-400' : 'text-amber-300'}>{detail.runtime_ready ? 'Compatible with current exact-path runtime. Publish/NGINX validation still required.' : 'Not publishable by the current runtime.'}</p>
      {detail.runtime_issues.length > 0 && <ul className="list-disc pl-5 text-amber-300">{detail.runtime_issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      <p>{detail.description || 'No description'}</p>
      <dl className="grid grid-cols-2 gap-2">
        <dt>Group</dt><dd>{detail.group}</dd><dt>Action</dt><dd>{detail.action}</dd>
        <dt>Severity / score</dt><dd>{detail.severity} / {detail.score}</dd>
        <dt>Priority</dt><dd>{detail.priority}</dd><dt>Policy binding</dt><dd>Unassigned</dd>
        <dt>Updated</dt><dd>{detail.updated_at}</dd>
      </dl>
      <h3 className="text-white">Conditions — {detail.logic_mode.toUpperCase()}</h3>
      {detail.conditions.map((condition, index) => <div key={index} className="bg-[#080E18] p-3 break-all"><p>{index + 1}. {condition.field}{condition.header_name ? ' [' + condition.header_name + ']' : ''} · {condition.operator}</p><code className="text-emerald-300">{condition.value}</code></div>)}
      <h3 className="text-white">Scope</h3>
      <dl className="grid grid-cols-2 gap-2 break-all">
        <dt>Source IP</dt><dd>{detail.source_ip || 'Any'}</dd><dt>Host</dt><dd>{detail.host_domain || 'Any'}</dd>
        <dt>Path prefix</dt><dd>{detail.path_prefix || 'Any'}</dd><dt>Method</dt><dd>{detail.http_method || 'Any'}</dd>
      </dl>
      <h3 className="text-white">Declared response / side effects</h3>
      <p>Status: {detail.response_code ?? 'Continue upstream'} · Body: {detail.custom_response || 'Default'}</p>
      <p>Security event: {detail.log_event ? 'Requested (unsupported)' : 'Not requested'} · IP reputation: {detail.add_to_reputation ? 'Requested (unsupported)' : 'Not requested'}</p>
      <h3 className="text-white">Recent immutable revisions</h3>
      {history.map(item => <p key={item.version}>rev{item.version} · {item.action} · {item.enabled ? 'enabled' : 'disabled'} · {item.actor} · {item.updated_at}</p>)}
      <p className="text-slate-500">Editing/rollback of extended definitions is a separate workflow; legacy update is blocked to preserve conditions and scope.</p>
    </>}
  </aside>;
}
