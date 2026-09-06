import React, { useState } from 'react';
import {
  X,
  ShieldAlert,
  Play,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  Pencil,
  FileCode2,
  Terminal,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SavedDetail } from './SavedRuleDetail';
import { getAuthToken } from '@/lib/fetcher';

function getHttpStatusText(code: number): string {
  switch (code) {
    case 200: return 'OK';
    case 201: return 'Created';
    case 204: return 'No Content';
    case 400: return 'Bad Request';
    case 401: return 'Unauthorized';
    case 403: return 'Forbidden';
    case 404: return 'Not Found';
    case 405: return 'Method Not Allowed';
    case 429: return 'Too Many Requests';
    case 500: return 'Internal Server Error';
    case 502: return 'Bad Gateway';
    case 503: return 'Service Unavailable';
    default: return code >= 400 ? 'Error' : 'OK';
  }
}

export interface ConditionEvaluationItem {
  field: string;
  operator: string;
  value: string;
  header_name?: string;
  extracted_value: string;
  matched: boolean;
}

export interface TestResultState {
  matched: boolean;
  action: string;
  responseCode: number;
  statusText: string;
  actionDispatched: string;
  latencyMs: number;
  evaluationTimeNs: number;
  matchedField: string;
  matchedPattern: string;
  matchedValue: string;
  highlightPrefix: string;
  highlightMatch: string;
  highlightSuffix: string;
  explanation: string;
  details: ConditionEvaluationItem[];
  responseHeaders: Record<string, string>;
  responseBody: string;
  rawHttpResponse: string;
  testedAt: string;
}

export interface PreviewRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  detail: SavedDetail;
}

interface SmoothHeightProps {
  children: React.ReactNode;
  className?: string;
  duration?: number;
  easing?: string;
}

function SmoothHeight({
  children,
  className = '',
  duration = 340,
  easing = 'cubic-bezier(0.25, 1, 0.5, 1)',
}: SmoothHeightProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const prevHeightRef = React.useRef<number | null>(null);
  const isAnimatingRef = React.useRef(false);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;

      const newHeight = Math.round(
        entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      );

      if (newHeight === 0) return;

      // On initial mount or before measurement
      if (prevHeightRef.current === null) {
        prevHeightRef.current = newHeight;
        container.style.height = 'auto';
        container.style.overflow = 'visible';
        return;
      }

      const prevHeight = prevHeightRef.current;
      if (Math.abs(newHeight - prevHeight) < 2) {
        return;
      }

      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      // If mid-animation, capture the actual visual height so redirect is smooth
      let startHeight = prevHeight;
      if (isAnimatingRef.current) {
        startHeight = Math.round(container.getBoundingClientRect().height);
      }

      isAnimatingRef.current = true;
      container.style.overflow = 'hidden';
      container.style.transition = 'none';
      container.style.height = `${startHeight}px`;

      // Force synchronous layout reflow so browser applies startHeight before transition
      void container.offsetHeight;

      // Transition smoothly to target height
      requestAnimationFrame(() => {
        if (!containerRef.current) return;
        container.style.transition = `height ${duration}ms ${easing}`;
        container.style.height = `${newHeight}px`;
      });

      const onTransitionEnd = (e: TransitionEvent) => {
        if (e.target !== container || e.propertyName !== 'height') return;
        isAnimatingRef.current = false;
        container.style.height = 'auto';
        container.style.transition = 'none';
        container.style.overflow = 'visible';
        container.removeEventListener('transitionend', onTransitionEnd);
      };

      container.addEventListener('transitionend', onTransitionEnd);

      timerRef.current = window.setTimeout(() => {
        if (!containerRef.current) return;
        isAnimatingRef.current = false;
        container.style.height = 'auto';
        container.style.transition = 'none';
        container.style.overflow = 'visible';
        prevHeightRef.current = newHeight;
      }, duration + 80);

      prevHeightRef.current = newHeight;
    });

    observer.observe(content);

    const handleWindowResize = () => {
      if (containerRef.current && contentRef.current) {
        containerRef.current.style.transition = 'none';
        containerRef.current.style.height = 'auto';
        containerRef.current.style.overflow = 'visible';
        prevHeightRef.current = Math.round(contentRef.current.offsetHeight);
        isAnimatingRef.current = false;
      }
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleWindowResize);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [duration, easing]);

  return (
    <div
      ref={containerRef}
      className={`will-change-[height] ${className}`}
      style={{ height: 'auto', overflow: 'visible' }}
    >
      <div ref={contentRef} className="w-full flow-root">
        {children}
      </div>
    </div>
  );
}

export function PreviewRuleModal({ isOpen, onClose, detail }: PreviewRuleModalProps) {
  const [activeTab, setActiveTab] = useState<'logic' | 'test' | 'result' | 'config'>('logic');
  const [testMethod, setTestMethod] = useState('GET');
  const [testUrl, setTestUrl] = useState(() => {
    if (detail.path_prefix) {
      return `https://example.com${detail.path_prefix.startsWith('/') ? detail.path_prefix : '/' + detail.path_prefix}`;
    }
    const condWithVal = detail.conditions?.find((c) => c.value);
    if (condWithVal) {
      const val = condWithVal.value;
      if (val.startsWith('/')) {
        return `https://example.com${val}`;
      }
      if (condWithVal.field?.toLowerCase().includes('query') || condWithVal.field?.toLowerCase().includes('uri')) {
        const cleanVal = val.replace(/^\(\?i\)/, '').replace(/[()\\+*?[\]^$|]/g, ' ').trim().split(/\s+/)[0] || 'test';
        return `https://example.com/search?q=${encodeURIComponent(cleanVal)}`;
      }
    }
    const grp = (detail.group || '').toLowerCase();
    if (grp === 'sqli') return 'https://example.com/search?q=1+or+1=1';
    if (grp === 'xss') return 'https://example.com/search?q=<script>alert(1)</script>';
    if (grp === 'traversal') return 'https://example.com/download?file=../../../../etc/passwd';
    return 'https://example.com/api/test';
  });
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResultState | null>(null);
  const [resultSubTab, setResultSubTab] = useState<'body' | 'headers' | 'raw'>('body');
  const [copiedResult, setCopiedResult] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [configSubTab, setConfigSubTab] = useState<'NGINX Config' | 'Lua Script' | 'JSON Definition'>('NGINX Config');
  const modalBodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (modalBodyRef.current && modalBodyRef.current.scrollTop > 0) {
      modalBodyRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [activeTab]);

  if (!isOpen) return null;

  // Extract patterns and conditions without hardcoded mock fallbacks
  const conditions = detail.conditions && detail.conditions.length > 0
    ? detail.conditions
    : (detail.path_prefix
        ? [{ field: 'Path Prefix', operator: 'Starts With', value: detail.path_prefix, header_name: '' }]
        : (detail.source_ip
            ? [{ field: 'Source IP', operator: 'CIDR Match', value: detail.source_ip, header_name: '' }]
            : []
          )
      );

  const primaryPattern = conditions[0]?.value || detail.path_prefix || detail.name || 'custom-pattern';

  const presetSamples: { label: string; url: string; method?: string }[] = (() => {
    const list: { label: string; url: string; method?: string }[] = [];
    const firstCond = conditions[0];
    const group = (detail.group || '').toLowerCase();

    if (group === 'sqli' || firstCond?.value?.includes('1=1') || firstCond?.value?.includes('union')) {
      list.push(
        { label: 'SQLi Attack Sample', url: 'https://example.com/search?q=1+or+1=1', method: 'GET' },
        { label: 'Union Select Attack', url: 'https://example.com/api/items?id=0+union+select+null,password+from+users', method: 'GET' },
        { label: 'Legitimate Request', url: 'https://example.com/items?query=laptop&page=1', method: 'GET' }
      );
    } else if (group === 'xss' || firstCond?.value?.includes('script')) {
      list.push(
        { label: 'XSS Script Payload', url: 'https://example.com/search?q=<script>alert(1)</script>', method: 'GET' },
        { label: 'IMG Tag XSS', url: 'https://example.com/profile?name=<img+src=x+onerror=alert(1)>', method: 'GET' },
        { label: 'Legitimate Request', url: 'https://example.com/search?q=laptop+accessories', method: 'GET' }
      );
    } else if (group === 'traversal' || firstCond?.value?.includes('..')) {
      list.push(
        { label: 'Directory Traversal', url: 'https://example.com/files?path=../../../../etc/passwd', method: 'GET' },
        { label: 'Encoded Traversal', url: 'https://example.com/download?file=%2e%2e%2f%2e%2e%2fwinnt', method: 'GET' },
        { label: 'Legitimate Request', url: 'https://example.com/files?path=documents/report.pdf', method: 'GET' }
      );
    } else if (group === 'endpoint' || detail.path_prefix) {
      const pfx = detail.path_prefix || '/admin';
      list.push(
        { label: 'Target Endpoint', url: `https://example.com${pfx.startsWith('/') ? pfx : '/' + pfx}`, method: 'GET' },
        { label: 'Health Endpoint', url: 'https://example.com/healthz', method: 'GET' },
        { label: 'Legitimate Request', url: 'https://example.com/public', method: 'GET' }
      );
    } else {
      const val = firstCond?.value || 'test';
      const cleanVal = val.replace(/^\(\?i\)/, '').replace(/[()\\+*?[\]^$|]/g, ' ').trim().split(/\s+/)[0] || 'sample';
      list.push(
        { label: 'Pattern Match Sample', url: `https://example.com/test?q=${encodeURIComponent(cleanVal)}`, method: 'GET' },
        { label: 'Legitimate Request', url: 'https://example.com/normal-path', method: 'GET' }
      );
    }
    return list;
  })();

  const handleCopyResult = () => {
    if (!testResult) return;
    let textToCopy = '';
    if (resultSubTab === 'body') {
      textToCopy = testResult.responseBody;
    } else if (resultSubTab === 'headers') {
      textToCopy = `HTTP/1.1 ${testResult.responseCode} ${testResult.statusText}\n${Object.entries(testResult.responseHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')}`;
    } else {
      textToCopy = testResult.rawHttpResponse;
    }
    navigator.clipboard.writeText(textToCopy);
    setCopiedResult(true);
    setTimeout(() => setCopiedResult(false), 2000);
  };

  // Interactive Test Execution via Live Backend Endpoint
  const handleRunTest = async () => {
    setIsTesting(true);
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const ruleIdNum = detail.id ? parseInt(String(detail.id), 10) : undefined;
      const res = await fetch('/api/v1/rules/test', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({
          rule_id: !isNaN(Number(ruleIdNum)) ? ruleIdNum : undefined,
          method: testMethod,
          url: testUrl,
          conditions: conditions.map((c) => ({
            field: c.field,
            operator: c.operator,
            value: c.value,
            header_name: c.header_name || '',
          })),
          logic_mode: detail.logic_mode || 'all',
          action: detail.action || 'block',
          response_code: detail.response_code || 403,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Server returned HTTP ${res.status}`);
      }

      const data = await res.json();

      const statusCode = data.matched
        ? (data.action === 'block' ? (data.response_code || detail.response_code || 403) : 200)
        : 200;
      const statusText = getHttpStatusText(statusCode);

      let responseBodyStr = '';
      if (data.matched && (data.action === 'block' || (!data.action && detail.action === 'block'))) {
        if (detail.custom_response && detail.custom_response.trim()) {
          responseBodyStr = detail.custom_response;
        } else {
          responseBodyStr = JSON.stringify(
            {
              error: statusText,
              status: statusCode,
              message: `Request blocked by Aurora WAF rule: "${detail.name || 'Security Rule'}"`,
              rule_id: detail.id,
              action: 'BLOCK',
              matched_field: data.matched_field || (data.details?.[0]?.field ?? 'request_uri'),
              client_ip: '127.0.0.1',
              timestamp: new Date().toISOString(),
            },
            null,
            2
          );
        }
      } else if (data.matched && data.action === 'log') {
        responseBodyStr = JSON.stringify(
          {
            status: 200,
            message: 'Request passed and logged by Aurora WAF audit rule.',
            action: 'LOG',
            rule_id: detail.id,
            eval_latency: `${(data.latency_ms || 0.08).toFixed(2)}ms`,
            upstream_status: 200,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        );
      } else {
        responseBodyStr = JSON.stringify(
          {
            status: 200,
            message: 'Request passed WAF inspection and was successfully forwarded to upstream service.',
            action: 'ALLOW',
            eval_latency: `${(data.latency_ms || 0.08).toFixed(2)}ms`,
            upstream_status: 200,
            timestamp: new Date().toISOString(),
          },
          null,
          2
        );
      }

      const bodyBytes = new TextEncoder().encode(responseBodyStr).length;
      const respHeaders: Record<string, string> = {
        'Date': new Date().toUTCString(),
      };

      if (data.matched && (data.action === 'block' || (!data.action && detail.action === 'block'))) {
        respHeaders['Server'] = 'aurora-waf/1.2.0';
        respHeaders['Content-Type'] = 'application/json; charset=utf-8';
        respHeaders['Content-Length'] = String(bodyBytes);
        respHeaders['Connection'] = 'close';
        respHeaders['X-Aurora-Action'] = 'BLOCK';
        respHeaders['X-Aurora-Rule-ID'] = String(detail.id || 'N/A');
        respHeaders['X-Aurora-Rule-Name'] = detail.name || 'custom-rule';
        respHeaders['X-Aurora-Latency'] = `${(data.latency_ms || 0.08).toFixed(2)}ms`;
      } else if (data.matched && data.action === 'log') {
        respHeaders['Server'] = 'upstream-backend/1.24.0';
        respHeaders['Content-Type'] = 'application/json; charset=utf-8';
        respHeaders['Content-Length'] = String(bodyBytes);
        respHeaders['Connection'] = 'keep-alive';
        respHeaders['X-Aurora-Action'] = 'LOG (Audit Recorded)';
        respHeaders['X-Aurora-Rule-ID'] = String(detail.id || 'N/A');
        respHeaders['X-Aurora-Latency'] = `${(data.latency_ms || 0.08).toFixed(2)}ms`;
      } else {
        respHeaders['Server'] = 'upstream-backend/1.24.0';
        respHeaders['Content-Type'] = 'application/json; charset=utf-8';
        respHeaders['Content-Length'] = String(bodyBytes);
        respHeaders['Connection'] = 'keep-alive';
        respHeaders['X-Aurora-Action'] = 'ALLOW (Pass-Through)';
        respHeaders['X-Aurora-Latency'] = `${(data.latency_ms || 0.08).toFixed(2)}ms`;
      }

      const rawHttp = `HTTP/1.1 ${statusCode} ${statusText}\n${Object.entries(respHeaders)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')}\n\n${responseBodyStr}`;

      // Calculate matching string without hardcoding patterns
      let matchStr = '';
      let matchedField = data.matched_field || '';
      let matchedPattern = data.matched_pattern || '';
      let matchedValue = data.matched_value || '';

      if (data.matched) {
        const matchedCond = (data.details as ConditionEvaluationItem[])?.find((d) => d.matched);
        if (matchedCond) {
          matchedField = matchedCond.field || matchedField;
          matchedPattern = matchedCond.value || matchedPattern;
          matchedValue = matchedCond.extracted_value || matchedValue;

          const val = matchedCond.value || '';
          const targetText = matchedCond.extracted_value || testUrl;

          if (matchedCond.operator?.toLowerCase().includes('regex') || val.startsWith('(?i)')) {
            try {
              const cleanRx = val.startsWith('(?i)') ? val.slice(4) : val;
              const rx = new RegExp(cleanRx, 'i');
              const m = rx.exec(targetText);
              if (m && m[0]) {
                matchStr = m[0];
              }
            } catch {
              if (val && targetText.toLowerCase().includes(val.toLowerCase())) {
                const idx = targetText.toLowerCase().indexOf(val.toLowerCase());
                matchStr = targetText.slice(idx, idx + val.length);
              }
            }
          } else if (matchedCond.operator?.toLowerCase() === 'equals') {
            matchStr = targetText;
          } else if (matchedCond.operator?.toLowerCase().includes('starts')) {
            matchStr = targetText.slice(0, val.length);
          } else if (matchedCond.operator?.toLowerCase().includes('ends')) {
            matchStr = targetText.slice(Math.max(0, targetText.length - val.length));
          } else {
            if (val && targetText.toLowerCase().includes(val.toLowerCase())) {
              const idx = targetText.toLowerCase().indexOf(val.toLowerCase());
              matchStr = targetText.slice(idx, idx + val.length);
            }
          }
        }
      }

      const fullUri = testUrl;
      const idx = matchStr ? fullUri.indexOf(matchStr) : -1;
      const highlightPrefix = idx >= 0 ? fullUri.slice(0, idx) : fullUri;
      const highlightMatch = idx >= 0 ? matchStr : '';
      const highlightSuffix = idx >= 0 ? fullUri.slice(idx + matchStr.length) : '';

      setTestResult({
        matched: data.matched,
        action: data.action || detail.action || 'block',
        responseCode: statusCode,
        statusText,
        actionDispatched: data.action_dispatched || (data.matched ? `HTTP ${statusCode} response` : 'HTTP 200 Pass Through'),
        latencyMs: data.latency_ms || 0.08,
        evaluationTimeNs: data.evaluation_time_ns || 0,
        matchedField: data.matched ? matchedField : '',
        matchedPattern: data.matched ? matchedPattern : '',
        matchedValue: data.matched ? matchedValue : '',
        highlightPrefix,
        highlightMatch,
        highlightSuffix,
        explanation: data.explanation || (data.matched ? `Matched condition in ${matchedField}` : 'No blocking conditions triggered'),
        details: data.details || [],
        responseHeaders: respHeaders,
        responseBody: responseBodyStr,
        rawHttpResponse: rawHttp,
        testedAt: new Date().toLocaleTimeString(),
      });
    } catch (err: any) {
      setTestResult({
        matched: false,
        action: 'error',
        responseCode: 500,
        statusText: 'Internal Server Error',
        actionDispatched: 'Execution Error',
        latencyMs: 0,
        evaluationTimeNs: 0,
        matchedField: '',
        matchedPattern: '',
        matchedValue: '',
        highlightPrefix: testUrl,
        highlightMatch: '',
        highlightSuffix: '',
        explanation: err?.message || 'Error occurred during test execution.',
        details: [],
        responseHeaders: {
          'HTTP/1.1': '500 Internal Server Error',
          'Date': new Date().toUTCString(),
          'Server': 'aurora-waf/1.2.0',
          'Content-Type': 'application/json',
        },
        responseBody: JSON.stringify({
          error: 'Execution Error',
          message: err?.message || 'Failed to communicate with rule evaluation endpoint.',
        }, null, 2),
        rawHttpResponse: `HTTP/1.1 500 Internal Server Error\n\n${err?.message || 'Error'}`,
        testedAt: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsTesting(false);
      setActiveTab('result');
    }
  };


  const nginxConfig = `# ${detail.name || 'custom-rule'}
location / {
    if ($request_uri ~* "${primaryPattern.replace(/"/g, '\\"')}") {
        return ${detail.response_code || 403};
    }
}`;

  const luaConfig = `-- Aurora WAF Lua Generated Rule
local uri = ngx.var.request_uri
if ngx.re.find(uri, [=[${primaryPattern}]=], "ijo") then
    return ngx.exit(${detail.response_code || 403})
end`;

  const jsonConfig = JSON.stringify(
    {
      id: detail.id,
      name: detail.name,
      enabled: detail.enabled,
      priority: detail.priority,
      conditions: conditions,
      action: detail.action || 'block',
      response_code: detail.response_code || 403,
    },
    null,
    2
  );

  const handleCopyConfig = () => {
    const textToCopy = configSubTab === 'NGINX Config' ? nginxConfig : configSubTab === 'Lua Script' ? luaConfig : jsonConfig;
    navigator.clipboard.writeText(textToCopy);
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in-0 duration-200">
      <div className="bg-card border border-border text-foreground rounded-lg shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col font-sans overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/40 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Preview Rule</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              See how this rule will be applied and test it with sample requests.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors rounded-sm cursor-pointer"
            aria-label="Close preview modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div ref={modalBodyRef} className="overflow-y-auto p-6 space-y-5 flex-1">
          
          {/* Summary Banner Card */}
          <div className="bg-muted/40 border border-border p-4 rounded-md flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0 mt-0.5">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-semibold text-sm text-foreground">{detail.name}</span>
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded-full uppercase tracking-wider">
                  {detail.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {detail.description || 'Block common SQL injection patterns in URI and query parameters.'}
              </p>
              <div className="flex items-center gap-4 mt-2 text-[11px] text-muted-foreground flex-wrap">
                <div>
                  <span>Assigned Policies: </span>
                  <span className="text-foreground font-medium">{detail.assigned_policies ?? 0}</span>
                </div>
                <span>•</span>
                <div>
                  <span>Priority: </span>
                  <span className="text-foreground font-medium">{detail.priority || 100}</span>
                </div>
                <span>•</span>
                <div className="flex items-center gap-1.5">
                  <span>Tags: </span>
                  <span className="px-1.5 py-0.5 bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xs text-[10px]">
                    {detail.group || 'custom'}
                  </span>
                  <span className="px-1.5 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 rounded-xs text-[10px]">
                    {detail.severity || 'medium'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-border pb-1 font-sans text-xs overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('logic')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 font-semibold transition-colors cursor-pointer ${
                activeTab === 'logic'
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Rule Logic</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('test')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 font-semibold transition-colors cursor-pointer ${
                activeTab === 'test'
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              <span>Test Request</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('result')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 font-semibold transition-colors cursor-pointer ${
                activeTab === 'result'
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Match Result</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('config')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-b-2 font-semibold transition-colors cursor-pointer ${
                activeTab === 'config'
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Generated Config</span>
            </button>
          </div>

          {/* Tab Content with Smooth Height Animation */}
          <SmoothHeight>
            <div
              key={activeTab}
              className="w-full animate-in fade-in-0 slide-in-from-bottom-2 duration-300 fill-mode-forwards"
            >
              {/* TAB 1: Rule Logic */}
              {activeTab === 'logic' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Column: Rule Conditions */}
              <div className="lg:col-span-7 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-foreground tracking-wide flex items-center gap-1.5">
                    <span>Rule Conditions</span>
                    <span className="px-1.5 py-0.2 bg-muted text-muted-foreground border border-border text-[10px] rounded font-mono">
                      {conditions.length} condition{conditions.length > 1 ? 's' : ''}
                    </span>
                  </h3>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    Logic: <strong className="text-primary font-bold">{detail.logic_mode ? detail.logic_mode.toUpperCase() : 'OR'}</strong>
                  </span>
                </div>

                <div className="space-y-2.5">
                  {conditions.map((cond, idx) => (
                    <React.Fragment key={idx}>
                      {idx > 0 && (
                        <div className="flex items-center justify-center my-1">
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-muted text-muted-foreground border border-border rounded">
                            {detail.logic_mode ? detail.logic_mode.toUpperCase() : 'OR'}
                          </span>
                        </div>
                      )}
                      <div className="bg-muted/40 border border-border p-3 rounded-sm space-y-1.5 shadow-2xs">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-foreground">{idx + 1}. {cond.field || 'Request URI'}</span>
                          <span className="text-[10px] font-mono text-muted-foreground">{cond.operator || 'Contains (Pattern)'}</span>
                        </div>
                        <div className="bg-background border border-border p-2 rounded-xs font-mono text-[11px] text-rose-600 dark:text-red-400 break-all select-all">
                          {cond.value}
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Right Column: Action Card */}
              <div className="lg:col-span-5 space-y-3">
                <h3 className="text-xs font-semibold text-foreground tracking-wide">Action & Response</h3>
                <div className="bg-muted/40 border border-border p-4 rounded-md space-y-3 text-xs shadow-2xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
                    <span className="font-semibold text-foreground uppercase tracking-wider text-[11px] font-sans">
                      {detail.action ? `${detail.action} Request` : 'Block Request'}
                    </span>
                  </div>

                  <div className="space-y-2.5 pt-2 border-t border-border text-[11px] font-sans">
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Response Code:</span>
                      <span className="text-foreground font-semibold font-mono">{detail.response_code || 403} Forbidden</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Custom Response:</span>
                      <span className="text-foreground truncate max-w-[180px]">{detail.custom_response || 'Request blocked by security policy.'}</span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Scope:</span>
                      <span className="text-foreground">
                        {detail.path_prefix ? `Path: ${detail.path_prefix}` : detail.source_ip ? `IP: ${detail.source_ip}` : 'Global Policy'}
                      </span>
                    </div>
                    <div className="flex justify-between py-1 border-b border-border/50">
                      <span className="text-muted-foreground">Log Event:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3" /> Enabled
                      </span>
                    </div>
                    <div className="flex justify-between py-1">
                      <span className="text-muted-foreground">IP Reputation:</span>
                      <span className={detail.add_to_reputation ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-muted-foreground'}>
                        {detail.add_to_reputation ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Test Request */}
          {activeTab === 'test' && (
            <div className="space-y-4 max-w-3xl mx-auto py-2">
              <div className="bg-muted/40 border border-border p-5 rounded-md space-y-4 shadow-xs">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Test against Rule Criteria</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Mô phỏng request HTTP để kiểm tra xem rule có chặn hoặc cho qua request này không.
                  </p>
                </div>

                {/* HTTP Request Form */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <select
                    value={testMethod}
                    onChange={(e) => setTestMethod(e.target.value)}
                    className="bg-background border border-input px-3 py-2 text-xs font-mono text-foreground rounded-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                  >
                    {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>

                  <input
                    type="text"
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                    placeholder="/api/v1/users?id=1%20UNION%20SELECT"
                    className="flex-1 bg-background border border-input px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground rounded-sm focus:outline-none focus:ring-1 focus:ring-primary transition-colors"
                  />

                  <button
                    type="button"
                    onClick={handleRunTest}
                    disabled={isTesting}
                    className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground rounded-sm text-xs font-semibold font-sans flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Testing...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Run Test</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Preset sample requests based on rule group & conditions */}
                <div className="pt-2 border-t border-border/50">
                  <span className="text-[11px] text-muted-foreground font-sans block mb-2">Preset Quick Samples:</span>
                  <div className="flex flex-wrap gap-2">
                    {presetSamples.map((sample, sIdx) => (
                      <button
                        key={sIdx}
                        type="button"
                        onClick={() => {
                          setTestUrl(sample.url);
                          if (sample.method) setTestMethod(sample.method);
                        }}
                        className="px-2.5 py-1 text-[11px] bg-background hover:bg-muted text-muted-foreground hover:text-foreground border border-border rounded transition-colors cursor-pointer"
                      >
                        {sample.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* cURL Command Preview */}
              <div className="bg-muted/30 border border-border p-4 rounded-md space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">cURL equivalent:</span>
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard.writeText(`curl -i -X ${testMethod} "${testUrl}"`); }}
                    className="text-[11px] text-primary hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copy command
                  </button>
                </div>
                <pre className="p-2.5 bg-background border border-border rounded text-[11px] font-mono text-foreground whitespace-pre-wrap break-all">
                  {`curl -i -X ${testMethod} "${testUrl}"`}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 3: Match Result */}
          {activeTab === 'result' && (
            <div className="space-y-4 max-w-4xl mx-auto py-2">
              {testResult ? (
                <div className="bg-muted/40 border border-border p-5 rounded-md space-y-4 shadow-xs animate-in fade-in-0 duration-300">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">Rule Evaluation Result</h3>
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 border border-border rounded">
                        Evaluated at {testResult.testedAt}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('test')}
                      className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <Play className="w-3 h-3" /> Run another test
                    </button>
                  </div>

                  {/* Result Status Banner */}
                  {testResult.matched ? (
                    <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded flex items-start gap-3.5">
                      <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-rose-700 dark:text-rose-300">
                              {testResult.action === 'block' ? 'Request would be BLOCKED' : `Request Action: ${testResult.action.toUpperCase()}`}
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-rose-500/20 border border-rose-500/40 text-rose-700 dark:text-rose-300 font-bold rounded">
                              HTTP {testResult.responseCode} {testResult.statusText}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] font-mono">
                            <span className="px-2 py-0.5 bg-background border border-border rounded text-foreground font-semibold">
                              {testResult.actionDispatched}
                            </span>
                            <span className="text-muted-foreground">
                              ⚡ {testResult.latencyMs.toFixed(2)} ms
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-rose-600/90 dark:text-rose-400/90 mt-1">
                          {testResult.explanation}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded flex items-start gap-3.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-emerald-700 dark:text-emerald-300">
                              Request would be ALLOWED
                            </span>
                            <span className="text-[11px] font-mono px-2 py-0.5 bg-emerald-500/20 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-bold rounded">
                              HTTP {testResult.responseCode} {testResult.statusText}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[11px] font-mono">
                            <span className="px-2 py-0.5 bg-background border border-border rounded text-foreground font-semibold">
                              {testResult.actionDispatched}
                            </span>
                            <span className="text-muted-foreground">
                              ⚡ {testResult.latencyMs.toFixed(2)} ms
                            </span>
                          </div>
                        </div>
                        <p className="text-xs text-emerald-600/90 dark:text-emerald-400/90 mt-1">
                          {testResult.explanation}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Simulated HTTP Response Inspector */}
                  <div className="bg-card border border-border rounded-md p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-foreground tracking-wide font-sans">
                          Simulated HTTP Response:
                        </span>
                        <div className="flex gap-1 border border-border bg-muted/50 p-0.5 rounded text-[11px] font-sans">
                          {(['body', 'headers', 'raw'] as const).map((tab) => (
                            <button
                              key={tab}
                              type="button"
                              onClick={() => setResultSubTab(tab)}
                              className={`px-2.5 py-0.5 rounded-xs transition-colors cursor-pointer capitalize ${
                                resultSubTab === tab
                                  ? 'bg-background text-foreground font-bold shadow-2xs'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {tab === 'body' ? 'Response Body' : tab === 'headers' ? 'Response Headers' : 'Raw HTTP'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyResult}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-sans rounded border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer shadow-2xs"
                      >
                        {copiedResult ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>
                          {copiedResult
                            ? 'Copied!'
                            : resultSubTab === 'body'
                            ? 'Copy Body'
                            : resultSubTab === 'headers'
                            ? 'Copy Headers'
                            : 'Copy Raw'}
                        </span>
                      </button>
                    </div>

                    {/* Status Line */}
                    <div className="flex items-center gap-2 text-xs font-mono py-1 px-2.5 bg-muted/60 border border-border/70 rounded text-foreground">
                      <span className="text-muted-foreground">Status:</span>
                      <span className={`font-bold ${testResult.responseCode >= 400 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        HTTP/1.1 {testResult.responseCode} {testResult.statusText}
                      </span>
                      <span className="text-muted-foreground ml-auto text-[11px]">
                        Content-Type: {testResult.responseHeaders['Content-Type'] || 'application/json'}
                      </span>
                    </div>

                    {/* Code Viewer */}
                    <div className="bg-muted/40 border border-border p-3.5 rounded font-mono text-xs text-foreground overflow-x-auto leading-relaxed shadow-inner max-h-60 overflow-y-auto">
                      {resultSubTab === 'body' && (
                        <pre className="whitespace-pre-wrap break-all select-all text-[11px]">
                          {testResult.responseBody}
                        </pre>
                      )}
                      {resultSubTab === 'headers' && (
                        <pre className="whitespace-pre-wrap break-all select-all text-[11px] text-slate-300">
                          {`HTTP/1.1 ${testResult.responseCode} ${testResult.statusText}\n` +
                            Object.entries(testResult.responseHeaders)
                              .map(([k, v]) => `${k}: ${v}`)
                              .join('\n')}
                        </pre>
                      )}
                      {resultSubTab === 'raw' && (
                        <pre className="whitespace-pre-wrap break-all select-all text-[11px] text-slate-300">
                          {testResult.rawHttpResponse}
                        </pre>
                      )}
                    </div>
                  </div>

                  {/* Condition Evaluation Breakdown Table */}
                  <div className="bg-card border border-border rounded-md p-4 space-y-3 shadow-2xs font-sans">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-foreground tracking-wide font-sans">
                        Rule Conditions Evaluation Breakdown
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Logic Mode: <strong className="text-foreground">{detail.logic_mode ? detail.logic_mode.toUpperCase() : 'ALL'}</strong>
                      </span>
                    </div>

                    {testResult.details && testResult.details.length > 0 ? (
                      <div className="border border-border rounded overflow-hidden overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-muted/70 text-muted-foreground border-b border-border text-[11px]">
                              <th className="py-2 px-3 font-semibold">#</th>
                              <th className="py-2 px-3 font-semibold">Target Field</th>
                              <th className="py-2 px-3 font-semibold">Operator</th>
                              <th className="py-2 px-3 font-semibold">Expected Pattern</th>
                              <th className="py-2 px-3 font-semibold">Extracted Value</th>
                              <th className="py-2 px-3 font-semibold text-right">Result</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {testResult.details.map((cond, cIdx) => (
                              <tr
                                key={cIdx}
                                className={cond.matched ? 'bg-emerald-500/5' : 'bg-background hover:bg-muted/30'}
                              >
                                <td className="py-2 px-3 text-muted-foreground text-[11px]">{cIdx + 1}</td>
                                <td className="py-2 px-3 font-medium text-foreground">
                                  {cond.field}
                                  {cond.header_name ? ` (${cond.header_name})` : ''}
                                </td>
                                <td className="py-2 px-3 text-muted-foreground text-[11px]">{cond.operator}</td>
                                <td className="py-2 px-3 font-mono text-[11px] text-rose-600 dark:text-rose-400 break-all max-w-xs">
                                  <span className="bg-muted px-1.5 py-0.5 rounded border border-border/60">
                                    {cond.value}
                                  </span>
                                </td>
                                <td className="py-2 px-3 font-mono text-[11px] text-foreground break-all max-w-xs">
                                  <span className="bg-muted/60 px-1.5 py-0.5 rounded border border-border/40 text-muted-foreground">
                                    {cond.extracted_value || '(empty)'}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right">
                                  {cond.matched ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold">
                                      <Check className="w-3 h-3" /> Matched
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground border border-border rounded text-[10px]">
                                      <X className="w-3 h-3" /> No Match
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="p-3 bg-muted/40 border border-border rounded text-xs text-muted-foreground text-center">
                        No individual conditions evaluated for this rule.
                      </div>
                    )}
                  </div>

                  {/* Pattern Match Highlight (Only shown when rule conditions matched) */}
                  {testResult.matched && (
                    <div className="p-3.5 bg-background border border-border rounded space-y-2.5 font-sans text-xs">
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Evaluated URL:</span>
                        <span className="text-foreground font-semibold font-mono break-all text-right max-w-sm">{testUrl}</span>
                      </div>
                      {testResult.matchedField && (
                        <div className="flex justify-between py-1 border-b border-border/50">
                          <span className="text-muted-foreground">Matched Field:</span>
                          <span className="text-primary font-semibold">{testResult.matchedField}</span>
                        </div>
                      )}
                      {testResult.matchedPattern && (
                        <div className="flex justify-between py-1 border-b border-border/50">
                          <span className="text-muted-foreground">Matched Rule Pattern:</span>
                          <code className="text-foreground font-mono max-w-xs truncate bg-muted px-1.5 py-0.5 border border-border rounded">
                            {testResult.matchedPattern}
                          </code>
                        </div>
                      )}

                      <div>
                        <span className="text-muted-foreground block mb-1">Pattern Match Highlight:</span>
                        <div className="p-2.5 bg-muted/60 border border-border text-foreground rounded text-xs break-all leading-relaxed font-mono">
                          {testResult.highlightPrefix}
                          {testResult.highlightMatch ? (
                            <span className="bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40 px-1 py-0.5 rounded font-bold">
                              {testResult.highlightMatch}
                            </span>
                          ) : null}
                          {testResult.highlightSuffix}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-muted/40 border border-border p-8 rounded-md text-center space-y-3 animate-in fade-in-0 duration-300">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground mx-auto">
                    <Play className="w-5 h-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">Chưa có kết quả kiểm tra</h3>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Gửi một request mẫu ở tab Test Request để xem phân tích chi tiết điều kiện khớp và phản hồi HTTP của rule.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('test')}
                    className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded text-xs font-semibold font-sans cursor-pointer transition-colors inline-flex items-center gap-1.5 shadow-xs"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Chuyển tới Test Request</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Generated Config */}
          {activeTab === 'config' && (
            <div className="space-y-4 max-w-3xl mx-auto py-2">
              <div className="bg-muted/40 border border-border p-5 rounded-md space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Generated NGINX & Lua Configuration</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Cấu hình runtime NGINX / Lua được tạo tự động từ rule này khi deploy.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyConfig}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans rounded border border-border bg-background hover:bg-muted text-foreground transition-colors cursor-pointer shadow-2xs"
                  >
                    {copiedConfig ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedConfig ? 'Copied!' : 'Copy Config'}</span>
                  </button>
                </div>

                {/* Config Subtabs */}
                <div className="flex gap-2 border-b border-border font-sans text-xs pt-1">
                  {(['NGINX Config', 'Lua Script', 'JSON Definition'] as const).map((cfgTab) => (
                    <button
                      key={cfgTab}
                      type="button"
                      onClick={() => setConfigSubTab(cfgTab)}
                      className={`px-3 py-1.5 border-b-2 font-medium transition-colors cursor-pointer ${
                        configSubTab === cfgTab
                          ? 'border-primary text-primary font-semibold'
                          : 'border-transparent text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {cfgTab}
                    </button>
                  ))}
                </div>

                {/* Code Viewers */}
                <div className="bg-muted/40 border border-border p-4 rounded font-mono text-xs text-foreground overflow-x-auto leading-relaxed shadow-inner">
                  <pre key={configSubTab} className="animate-in fade-in-0 duration-200">
                    {configSubTab === 'NGINX Config' ? nginxConfig : configSubTab === 'Lua Script' ? luaConfig : jsonConfig}
                  </pre>
                </div>
              </div>
            </div>
          )}
            </div>
          </SmoothHeight>

        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-border bg-muted/40 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-background hover:bg-muted border border-border text-foreground text-xs font-medium rounded-sm transition-colors cursor-pointer shadow-2xs"
          >
            Close
          </button>
          <Link
            to={`/rules/edit/${detail.id}`}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-sm transition-colors cursor-pointer shadow-xs"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span>Edit Rule</span>
          </Link>
        </div>

      </div>
    </div>
  );
}
