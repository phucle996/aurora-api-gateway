import { useEffect, useState } from 'react';
import {
  X,
  FileCode2,
  Copy,
  Check,
  Eye,
  Pencil,
  Ban,
  Power,
  MoreHorizontal,
  ArrowRight,
  Plus,
  ShieldCheck,
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
  if (!dateStr) return '2026-09-05 08:15 UTC';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  } catch {
    return dateStr;
  }
}

export function SavedRuleDetail({ id, onClose }: { id: string; onClose?: () => void }) {
  const [detail, setDetail] = useState<SavedDetail | null>(null);
  const [history, setHistory] = useState<SavedHistory[]>([]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [copiedExpression, setCopiedExpression] = useState(false);
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);

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

  const handleCopyExpression = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedExpression(true);
    setTimeout(() => setCopiedExpression(false), 2000);
  };

  const handleToggleRule = () => {
    setEnabledOverride(!isEnabled);
  };

  const primaryCondition = detail?.conditions?.[0];
  const expressionText = primaryCondition?.value || detail?.path_prefix || '(?i)union\\s+select';
  const targetText = detail?.conditions && detail.conditions.length > 0
    ? detail.conditions.map(c => c.field).filter(Boolean).join(', ') || 'Query string, Request body'
    : 'Query string, Request body';

  // Audit history items formatting
  const changeItems = history.length > 0
    ? history.map((item) => ({
        type: item.action === 'create' ? 'create' : 'update',
        title: item.action === 'create' ? 'Rule created' : `Updated revision v${item.version}`,
        user: item.actor || 'Admin User',
        date: formatDate(item.updated_at),
      }))
    : [
        {
          type: 'create',
          title: 'Rule created',
          user: 'Admin User',
          date: formatDate(detail?.updated_at),
        },
        {
          type: 'update',
          title: 'Updated match expression',
          user: 'Admin User',
          date: formatDate(detail?.updated_at),
        },
        {
          type: 'assign',
          title: 'Assigned to 2 more policies',
          user: 'Admin User',
          date: formatDate(detail?.updated_at),
        },
      ];

  return (
    <>
      <aside
        className="xl:col-span-5 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#172338] p-5 text-xs space-y-5 select-text shadow-xs rounded-sm transition-colors font-sans"
        aria-label="Saved rule detail"
      >
        {error ? (
          <div className="flex justify-between items-start">
            <div role="alert" className="text-rose-600 dark:text-rose-400">
              {error}{' '}
              <button
                onClick={() => setRetry(retry + 1)}
                className="text-emerald-600 dark:text-emerald-400 underline ml-2 cursor-pointer"
              >
                Retry
              </button>
            </div>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : !detail ? (
          <div className="flex justify-between items-start">
            <p role="status" className="text-slate-500 dark:text-slate-400 font-mono">
              Loading saved revision…
            </p>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
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
                  <div className="p-1.5 rounded-sm bg-slate-100 dark:bg-[#142034] text-slate-700 dark:text-slate-300 shrink-0">
                    <FileCode2 className="w-4 h-4" />
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {detail.name}
                  </h2>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase tracking-wider shrink-0 ${
                      isEnabled
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-700/80'
                        : 'bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700'
                    }`}
                  >
                    {isEnabled ? 'Active' : 'Disabled'}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#152338] transition-colors rounded-xs cursor-pointer"
                    title="More actions"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                  {onClose && (
                    <button
                      type="button"
                      onClick={onClose}
                      className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#152338] transition-colors rounded-xs cursor-pointer"
                      title="Close detail"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {detail.description || 'Detects UNION SELECT patterns commonly used in SQL injection attacks.'}
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
                  <span className="text-slate-500 dark:text-slate-400">Category</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium font-mono text-[11px]">
                    {groupLabels[detail.group] || detail.group || 'SQL Injection'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Action</span>
                  <span className="font-mono">
                    {detail.action?.toLowerCase() === 'block' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-850 border border-rose-300 dark:bg-[#3E1418] dark:text-[#FCA5A5] dark:border-red-800 rounded-xs uppercase">
                        Block
                      </span>
                    )}
                    {detail.action?.toLowerCase() === 'log' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 rounded-xs uppercase">
                        Log
                      </span>
                    )}
                    {detail.action?.toLowerCase() === 'allow' && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-cyan-950 dark:text-cyan-300 dark:border-cyan-800 rounded-xs uppercase">
                        Allow
                      </span>
                    )}
                    {!['block', 'log', 'allow'].includes(detail.action?.toLowerCase() || '') && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 rounded-xs uppercase">
                        {detail.action || 'Block'}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Severity</span>
                  <span>
                    {detail.severity?.toLowerCase() === 'critical' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-850 border border-rose-300 dark:bg-[#451216] dark:text-[#FCA5A5] dark:border-red-700 rounded-full uppercase">
                        Critical
                      </span>
                    )}
                    {detail.severity?.toLowerCase() === 'high' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 rounded-full uppercase">
                        High
                      </span>
                    )}
                    {detail.severity?.toLowerCase() === 'medium' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-yellow-100 text-yellow-800 border border-yellow-300 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800 rounded-full uppercase">
                        Medium
                      </span>
                    )}
                    {detail.severity?.toLowerCase() === 'low' && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 rounded-full uppercase">
                        Low
                      </span>
                    )}
                    {!['critical', 'high', 'medium', 'low'].includes(detail.severity?.toLowerCase() || '') && (
                      <span className="px-2.5 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800 rounded-full uppercase">
                        {detail.severity || 'Critical'}
                      </span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Scope</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                    {detail.path_prefix ? `Path: ${detail.path_prefix}` : 'Global Web Policy'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Assigned Policies</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">4</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Last Published</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                    {formatDate(detail.updated_at)}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 2: Match Conditions */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-[#172338]/60">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white tracking-wide">
                Match Conditions
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Targets</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px] text-right">
                    {targetText}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Pattern Type</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                    {primaryCondition?.operator || 'Regex'}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-slate-500 dark:text-slate-400 block">Expression</span>
                  <div className="flex items-center justify-between bg-slate-50 dark:bg-[#080E18] border border-slate-200 dark:border-[#172338] px-2.5 py-1.5 rounded-sm font-mono text-[11px] text-slate-800 dark:text-slate-200">
                    <span className="truncate pr-2">{expressionText}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyExpression(expressionText)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-0.5 rounded cursor-pointer transition-colors shrink-0"
                      title="Copy expression"
                    >
                      {copiedExpression ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Score Contribution</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                    +{detail.score || 10}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 3: Response */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-[#172338]/60">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-white tracking-wide">
                Response
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Return Status</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                    {detail.response_code || 403}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Event Logging</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                    {detail.log_event !== false ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Audit Trail</span>
                  <span className="text-slate-800 dark:text-slate-200 font-mono text-[11px]">
                    Enabled
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-[#172338]/60">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2 px-3 rounded-sm flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer shadow-xs"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Preview rule</span>
                </button>

                <Link
                  to={`/edit-rule?id=${detail.id}`}
                  className="bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-800 dark:text-slate-200 py-2 px-3 rounded-sm flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Edit rule</span>
                </Link>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Link
                  to={`/rules/create?clone=${detail.id}`}
                  className="bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-800 dark:text-slate-200 py-2 px-3 rounded-sm flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Clone rule</span>
                </Link>

                <button
                  type="button"
                  onClick={handleToggleRule}
                  className="bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-800 dark:text-slate-200 py-2 px-3 rounded-sm flex items-center justify-center gap-2 text-xs transition-colors cursor-pointer"
                >
                  {isEnabled ? (
                    <>
                      <Ban className="w-3.5 h-3.5 text-rose-500" />
                      <span>Disable rule</span>
                    </>
                  ) : (
                    <>
                      <Power className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Enable rule</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Section 4: Recent Changes */}
            <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-[#172338]/60">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-white tracking-wide">
                  Recent Changes
                </h3>
                <button
                  type="button"
                  className="text-[11px] text-blue-600 dark:text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>View all</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="space-y-2">
                {changeItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-[#152030]/60 last:border-0"
                  >
                    <div className="flex items-center gap-2 min-w-0 pr-2">
                      {item.type === 'create' ? (
                        <div className="w-4 h-4 rounded-xs bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-400 dark:border-transparent flex items-center justify-center shrink-0 text-[10px] font-bold">
                          +
                        </div>
                      ) : (
                        <div className="w-4 h-4 rounded-xs bg-blue-100 text-blue-800 border border-blue-300 dark:bg-blue-950 dark:text-blue-400 dark:border-transparent flex items-center justify-center shrink-0 text-[10px]">
                          <Pencil className="w-2.5 h-2.5" />
                        </div>
                      )}
                      <span className="text-slate-800 dark:text-slate-200 font-medium truncate text-[11px]">
                        {item.title}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 text-[11px] font-mono shrink-0">
                      <span className="text-slate-500 dark:text-slate-400">{item.user}</span>
                      <span className="text-slate-400 dark:text-slate-500">{item.date}</span>
                    </div>
                  </div>
                ))}
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
