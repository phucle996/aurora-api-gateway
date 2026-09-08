import { useEffect, useRef, useState } from 'react';
import { getAuthToken } from '../../../lib/fetcher';

interface EditRuleTesterProps {
  conditions: { field: string; operator: string; value: string; header_name?: string }[];
  ruleId: string;
  logicMode: 'all' | 'any';
  action: 'block' | 'allow' | 'log';
  responseCode: number;
}
interface EditEvaluation {
  matched: boolean;
  action: string;
  action_dispatched: string;
  latency_ms: number;
  evaluation_time_ns: number;
  details: unknown[];
}

export function EditRuleTesterPanel({ conditions, ruleId, logicMode, action, responseCode }: EditRuleTesterProps) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('/');
  const [headers, setHeaders] = useState('{}');
  const [body, setBody] = useState('');
  const [clientIP, setClientIP] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ input: string; value: EditEvaluation } | null>(null);
  const request = useRef<AbortController | null>(null);
  const input = JSON.stringify({ conditions, logic_mode: logicMode, action, response_code: responseCode, method, url, body, headers, client_ip: clientIP });
  useEffect(() => {
    request.current?.abort();
    setResult(null);
    setError('');
    setBusy(false);
    return () => request.current?.abort();
  }, [input, ruleId]);

  const send = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const parsed: unknown = JSON.parse(headers);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.values(parsed).some(value => typeof value !== 'string')) {
        throw new Error('Headers must be a JSON object of strings.');
      }
      if (!conditions.length) throw new Error('Add at least one condition before testing.');
      const token = getAuthToken();
      const response = await fetch('/api/v1/rules/test', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ ...JSON.parse(input), headers: parsed }),
      });
      if (!response.ok) throw new Error(`Evaluation failed (${response.status}): ${await response.text()}`);
      const data = await response.json();
      if (typeof data.matched !== 'boolean' || data.action !== action || !Number.isFinite(data.latency_ms) || !Number.isFinite(data.evaluation_time_ns) || !Array.isArray(data.details)) {
        throw new Error('Invalid evaluator response.');
      }
      if (!controller.signal.aborted) setResult({ input, value: data });
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Evaluation failed.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <section className="bg-card border border-border p-4 space-y-3 text-xs text-foreground" aria-label="Test draft rule">
      <h2 className="text-sm font-semibold">Test draft rule</h2>
      <p className="text-muted-foreground">Evaluates these unsaved conditions on the controller. Scope filters and node enforcement are not tested. No upstream request or security event is produced.</p>
      <div className="flex gap-2">
        <select aria-label="Draft test method" value={method} onChange={e => setMethod(e.target.value)} className="bg-background border p-2">
          {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map(m => <option key={m}>{m}</option>)}
        </select>
        <input aria-label="Draft test URL" value={url} onChange={e => setUrl(e.target.value)} className="bg-background border p-2 min-w-0 flex-1" />
      </div>
      <label className="block">Headers (JSON)<textarea aria-label="Draft test headers" value={headers} onChange={e => setHeaders(e.target.value)} className="block w-full bg-background border p-2" /></label>
      <label className="block">Body<textarea aria-label="Draft test body" value={body} onChange={e => setBody(e.target.value)} className="block w-full bg-background border p-2" /></label>
      <label className="block">Client IP<input aria-label="Draft test client IP" value={clientIP} onChange={e => setClientIP(e.target.value)} className="block w-full bg-background border p-2" /></label>
      <button type="button" disabled={busy} onClick={send} className="bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50">{busy ? 'Testing…' : 'Test draft'}</button>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {result?.input === input && <section aria-label="Draft evaluation result" className="space-y-2">
        <p>{result.value.matched ? 'Conditions matched' : 'Conditions did not match'} · configured action: {result.value.action}</p>
        <p>Measured evaluation: {result.value.evaluation_time_ns} ns</p>
        <pre className="overflow-auto bg-background p-3">{JSON.stringify(result.value, null, 2)}</pre>
      </section>}
    </section>
  );
}
