import { useEffect, useRef, useState } from 'react';
import {
  X,
  FileCode2,
  Copy,
  Check,
  Eye,
  Pencil,
  Ban,
  Power,
  ArrowRight,
  AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAuthToken } from '../../../lib/fetcher';
import { PreviewRuleModal } from './PreviewRuleModal';

export interface SavedDetail {
  id: string;
  version: number;
  schema_version: number;
  name: string;
  description: string;
  group: string;
  action: string;
  severity: string;
  score: number;
  priority: number;
  enabled: boolean;
  assigned_policies: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  runtime_ready: boolean;
  runtime_issues: string[];
  logic_mode: string;
  conditions: { field: string; operator: string; value: string; header_name: string }[];
  source_ip: string;
  host_domain: string;
  path_prefix: string;
  http_method: string;
  response_code: number | null;
  custom_response: string;
  log_event: boolean;
  add_to_reputation: boolean;
}

export interface SavedHistory {
  version: number;
  action: string;
  enabled: boolean;
  actor: string;
  updated_at: string;
}

const groupLabels: Record<string, string> = {
  sqli: 'SQL Injection',
  xss: 'XSS',
  traversal: 'Path Traversal',
  bot: 'Bot Detection',
  endpoint: 'Sensitive Endpoint',
  authentication: 'Authentication',
  custom: 'Custom',
};

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  } catch {
    return dateStr;
  }
}

export function SavedRuleDetail({ id, onClose, onChanged }: { id: string; onClose?: () => void; onChanged?: () => void }) {
  const [detail, setDetail] = useState<SavedDetail | null>(null);
  const [history, setHistory] = useState<SavedHistory[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [copiedExpression, setCopiedExpression] = useState(false);
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const [isToggling, setIsToggling] = useState(false);
  const toggling = useRef(false);
  const attempt = useRef<{ version: number; id: string; key: string } | null>(null);
  const activeId = useRef(id);
  activeId.current = id;

  useEffect(() => {
    if (!id) {
      setDetail(null);
      setEnabledOverride(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setHistory([]);
    setError('');
    setEnabledOverride(null);
    const authToken = getAuthToken();
    const authHeaders: Record<string, string> = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    (async () => {
      try {
        const [record, audit] = await Promise.all([
          fetch('/api/v1/rules/' + encodeURIComponent(id), { headers: authHeaders, credentials: 'same-origin', signal: controller.signal }),
          fetch('/api/v1/rules/' + encodeURIComponent(id) + '/history?limit=10', { headers: authHeaders, credentials: 'same-origin', signal: controller.signal }),
        ]);
        if (!record.ok || !audit.ok) throw new Error(`Cannot load saved rule (${record.status}/${audit.status}).`);
        const value = await record.json();
        const revisions = await audit.json();
        if (!controller.signal.aborted) {
          setDetail(value);
          setHistory(Array.isArray(revisions.items) ? revisions.items : []);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Read failed.');
      }
    })();
    return () => controller.abort();
  }, [id, retry]);

  if (!id) return null;

  const isEnabled = enabledOverride !== null ? enabledOverride : (detail?.enabled ?? true);

  const handleCopyExpression = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { alert('Copy failed.'); return; }
    setCopiedExpression(true);
    setTimeout(() => setCopiedExpression(false), 2000);
  };

  const handleToggleRule = async () => {
    if (!detail || toggling.current) return;
    toggling.current = true;
    if (attempt.current?.version !== detail.version || attempt.current?.id !== detail.id) {
      attempt.current = { version: detail.version, id: detail.id, key: crypto.randomUUID() };
    }
    setIsToggling(true);
    const nextState = !isEnabled;
    const authToken = getAuthToken();
    try {
      const res = await fetch('/api/v2/rules/' + encodeURIComponent(detail.id), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          'Idempotency-Key': attempt.current.key,
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          expected_version: detail.version,
          name: detail.name,
          description: detail.description,
          group: detail.group,
          severity: detail.severity,
          score: detail.score,
          enabled: nextState,
          priority: detail.priority,
          policy_id: null,
          logic_mode: detail.logic_mode || 'all',
          conditions: detail.conditions || [],
          action: detail.action,
          response_code: detail.response_code,
          custom_response: detail.custom_response,
          log_event: detail.log_event,
          add_to_reputation: detail.add_to_reputation,
          source_ip: detail.source_ip,
          host_domain: detail.host_domain,
          path_prefix: detail.path_prefix,
          http_method: detail.http_method,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to update rule status (${res.status})`);
      }
      await res.json();
      if (activeId.current === detail.id) {
        setRetry(value => value + 1);
        onChanged?.();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Toggle rule failed.');
    } finally {
      toggling.current = false;
      setIsToggling(false);
    }
  };

  const primaryCondition = detail?.conditions?.[0];
  const expressionText = primaryCondition?.value || detail?.path_prefix || detail?.source_ip || '—';
  const targetText = detail?.conditions && detail.conditions.length > 0
    ? detail.conditions.map(c => c.field).filter(Boolean).join(', ')
    : detail?.path_prefix ? 'Path prefix' : detail?.source_ip ? 'Client IP' : '—';

  // Audit history items formatting
  const changeItems = history.map((item) => ({
    type: item.version === 1 ? 'create' : 'update',
    title: `Saved revision v${item.version}`,
    user: item.actor || 'Unknown',
    date: formatDate(item.updated_at),
  }));

  return (
    <>
      <aside
        className="xl:col-span-5 bg-card border border-border p-5 text-xs space-y-5 select-text shadow-xs rounded-sm transition-colors font-sans"
        aria-label="Saved rule detail"
      >
        {error ? (
          <div className="flex justify-between items-start">
            <div role="alert" className="text-destructive">
              {error}{' '}
              <button
                onClick={() => setRetry(retry + 1)}
                className="text-primary underline ml-2 cursor-pointer font-medium"
              >
                Retry
              </button>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : !detail ? (
          <div className="flex justify-between items-start">
            <p role="status" className="text-muted-foreground font-sans">
              Loading saved revision…
            </p>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Header: Title, Status, and Controls */}
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-sm bg-muted text-foreground shrink-0">
                    <FileCode2 className="w-4 h-4" />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground truncate">
                    {detail.name}
                  </h2>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0 ${isEnabled
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'bg-muted text-muted-foreground border border-border'
                      }`}
                  >
                    {isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {onClose && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors rounded-xs cursor-pointer"
                      title="Close detail"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {detail.description || 'No description provided.'}
              </p>

              {/* Runtime Warning if not publishable */}
              {!detail.runtime_ready && (
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xs text-[11px] text-amber-700 dark:text-amber-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Not publishable by the current runtime.</span>
                  </div>
                  {detail.runtime_issues && detail.runtime_issues.length > 0 && (
                    <ul className="list-disc pl-5 space-y-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                      {detail.runtime_issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Section 1: Overview */}
            <div className="space-y-2.5 pt-1">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white tracking-wide">
                Overview
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Category</span>
                  <span className="text-foreground font-medium font-sans text-[11px]">
                    {groupLabels[detail.group] || detail.group || '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Action</span>
                  <span className="font-sans">
                    {detail.action?.toLowerCase() === 'block' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/30 rounded-xs uppercase">
                        Block
                      </span>
                    )}
                    {detail.action?.toLowerCase() === 'log' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-muted text-foreground border border-border rounded-xs uppercase">
                        Log
                      </span>
                    )}
                    {detail.action?.toLowerCase() === 'allow' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-primary/10 text-primary border border-primary/30 rounded-xs uppercase">
                        Allow
                      </span>
                    )}
                    {!['block', 'log', 'allow'].includes(detail.action?.toLowerCase() || '') && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground border border-border rounded-xs uppercase">
                        {detail.action || '—'}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Severity</span>
                  <span>
                    {detail.severity?.toLowerCase() === 'critical' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/30 rounded-full uppercase">
                        Critical
                      </span>
                    )}
                    {detail.severity?.toLowerCase() === 'high' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-full uppercase">
                        High
                      </span>
                    )}
                    {detail.severity?.toLowerCase() === 'medium' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/30 rounded-full uppercase">
                        Medium
                      </span>
                    )}
                    {detail.severity?.toLowerCase() === 'low' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-muted text-muted-foreground border border-border rounded-full uppercase">
                        Low
                      </span>
                    )}
                    {!['critical', 'high', 'medium', 'low'].includes(detail.severity?.toLowerCase() || '') && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-destructive/10 text-destructive border border-destructive/30 rounded-full uppercase">
                        {detail.severity || '—'}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Scope</span>
                  <span className="text-foreground font-sans text-[11px]">
                    {[detail.source_ip && `IP: ${detail.source_ip}`, detail.host_domain && `Host: ${detail.host_domain}`, detail.path_prefix && `Path: ${detail.path_prefix}`, detail.http_method && `Method: ${detail.http_method}`].filter(Boolean).join('; ') || 'No scope filters'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Assigned Policies</span>
                  <span className="text-foreground font-mono text-[11px]">
                    {detail.assigned_policies ?? 0}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Last Saved</span>
                  <span className="text-foreground font-mono text-[11px]">
                    {formatDate(detail.updated_at)}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 2: Match Conditions */}
            <div className="space-y-2.5 pt-2 border-t border-border">
              <h3 className="text-xs font-semibold text-foreground tracking-wide">
                Match Conditions
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Targets</span>
                  <span className="text-foreground font-sans text-[11px] text-right">
                    {targetText}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Pattern Type</span>
                  <span className="text-foreground font-sans text-[11px]">
                    {primaryCondition?.operator || '—'}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-muted-foreground block">Expression</span>
                  <div className="flex items-center justify-between bg-muted/40 border border-border px-2.5 py-1.5 rounded-sm font-mono text-[11px] text-foreground">
                    <span className="truncate pr-2">{expressionText}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyExpression(expressionText)}
                      className="text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer transition-colors shrink-0"
                      title="Copy expression"
                    >
                      {copiedExpression ? (
                        <Check className="w-3.5 h-3.5 text-primary" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Section 3: Action Details */}
            <div className="space-y-2.5 pt-2 border-t border-border">
              <h3 className="text-xs font-semibold text-foreground tracking-wide">
                Action Details
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Response Code</span>
                  <span className="text-foreground font-mono text-[11px]">
                    {detail.response_code ?? '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Log Security Event</span>
                  <span className={`font-medium ${detail.log_event ? 'text-primary' : 'text-muted-foreground'}`}>
                    {detail.log_event ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Add to Reputation</span>
                  <span className={`font-medium ${detail.add_to_reputation ? 'text-primary' : 'text-muted-foreground'}`}>
                    {detail.add_to_reputation ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(true)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2 px-3 rounded-sm flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer shadow-xs"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Preview rule</span>
                </button>

                <Link
                  to={`/rules/${detail.id}/edit`}
                  className="bg-muted hover:bg-accent border border-border text-foreground py-2 px-3 rounded-sm flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Edit rule</span>
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-2">

                <button
                  type="button"
                  disabled={isToggling}
                  onClick={handleToggleRule}
                  className="bg-muted hover:bg-accent border border-border text-foreground py-2 px-3 rounded-sm flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isEnabled ? (
                    <>
                      <Ban className="w-3.5 h-3.5 text-destructive" />
                      <span>{isToggling ? 'Updating...' : 'Disable rule'}</span>
                    </>
                  ) : (
                    <>
                      <Power className="w-3.5 h-3.5 text-primary" />
                      <span>{isToggling ? 'Updating...' : 'Enable rule'}</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Section 4: Recent Changes */}
            <div className="space-y-2.5 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-foreground tracking-wide">
                  Recent Changes
                </h3>
                <Link
                  to={`/rules/${encodeURIComponent(detail.id)}/history`}
                  className="text-[11px] text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>View all</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="space-y-2">
                {changeItems.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground italic py-2">
                    No revisions recorded yet.
                  </p>
                ) : (
                  changeItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs py-1 border-b border-border last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {item.type === 'create' ? (
                          <div className="w-4 h-4 rounded-xs bg-primary/10 text-primary border border-primary/30 flex items-center justify-center shrink-0 text-[10px] font-bold">
                            +
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded-xs bg-muted text-foreground border border-border flex items-center justify-center shrink-0 text-[10px]">
                            <Pencil className="w-2.5 h-2.5" />
                          </div>
                        )}
                        <span className="text-foreground font-medium truncate text-[11px]">
                          {item.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-2.5 text-[11px] shrink-0">
                        <span className="text-muted-foreground font-sans">{item.user}</span>
                        <span className="text-muted-foreground font-mono">{item.date}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </aside>

      {/* Preview Rule Modal */}
      {detail && (
        <PreviewRuleModal
          isOpen={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          detail={detail}
        />
      )}
    </>
  );
}
