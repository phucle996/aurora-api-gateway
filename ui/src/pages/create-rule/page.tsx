import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateRuleHeader } from './sections/CreateRuleHeader';
import { BasicInfoSection } from './sections/BasicInfoSection';
import {
  MatchConditionsSection,
  type Condition,
} from './sections/MatchConditionsSection';
import { ActionsSection } from './sections/ActionsSection';
import { ScopeSection } from './sections/ScopeSection';
import { RulePreviewPanel } from './sections/RulePreviewPanel';
import { getAuthToken } from '../../lib/fetcher';
import {
  RuleTemplatesPanel,
  type TemplateData,
} from './sections/RuleTemplatesPanel';
import { RuleActivationDialog } from './sections/RuleActivationDialog';
import { Save } from 'lucide-react';
import { policiesApi, type PolicyCatalogItem } from '../../lib/api/policies';

export default function CreateRulePage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const attempt = useRef<{ key: string; payload: string } | null>(null);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [group, setGroup] = useState('custom');
  const [severity, setSeverity] = useState('medium');
  const [score, setScore] = useState(0);

  // Form states
  const [ruleName, setRuleName] = useState('');
  const [description, setDescription] = useState('');
  const [policy, setPolicy] = useState('');
  const [policyCatalog, setPolicyCatalog] = useState<PolicyCatalogItem[]>([]);
  const [isLoadingPolicies, setIsLoadingPolicies] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(100);
  const [isActivationDialogOpen, setIsActivationDialogOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setIsLoadingPolicies(true);
    policiesApi
      .catalog()
      .then((data) => {
        if (!active) return;
        setPolicyCatalog(data || []);
      })
      .catch(() => {
        if (!active) return;
        setPolicyCatalog([]);
      })
      .finally(() => {
        if (active) setIsLoadingPolicies(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const [conditions, setConditions] = useState<Condition[]>([
    {
      id: 'cond-1',
      field: 'Request Path',
      operator: 'Equals',
      value: '/admin',
    },
  ]);
  const [logicMode, setLogicMode] = useState<'ALL' | 'ANY'>('ALL');

  const [actionType, setActionType] = useState('Block Request');
  const [responseCode, setResponseCode] = useState('403 Forbidden');
  const [customResponse, setCustomResponse] = useState('');
  const [logEvent, setLogEvent] = useState(false);
  const [addToReputation, setAddToReputation] = useState(false);

  const [sourceIP, setSourceIP] = useState('');
  const [hostDomain, setHostDomain] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [httpMethod, setHttpMethod] = useState('All Methods');

  const handleSelectTemplate = (t: TemplateData) => {
    setRuleName(t.name);
    setDescription(t.description);
    setConditions([
      {
        id: 'cond-1',
        field: t.field,
        operator: t.operator === 'Contains (Pattern)' ? 'Regex Match' : t.operator,
        value: t.pattern,
      },
    ]);
  };

  const handleScrollToTemplates = () => {
    const el = document.getElementById('rule-templates');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const fields: Record<string, string> = { 'Request URI': 'uri_raw', 'Request Path': 'path', 'Query String': 'query', 'Request Header': 'header', 'Request Body': 'body', 'Client IP': 'client_ip', 'HTTP Method': 'method' };
  const operators: Record<string, string> = { 'Contains (Pattern)': 'contains', 'Equals': 'equals', 'Starts With': 'starts_with', 'Ends With': 'ends_with', 'Regex Match': 'regex', 'In CIDR Range': 'cidr' };
  const actions: Record<string, string> = { 'Block Request': 'block', 'Allow Request': 'allow', 'Log Only / Monitor': 'log' };
  const definition = {
    name: ruleName, description, group, severity, score, enabled, priority,
    policy_id: null, logic_mode: logicMode.toLowerCase(),
    conditions: conditions.map(c => ({ field: fields[c.field], operator: operators[c.operator], value: c.value, header_name: c.field === 'Request Header' ? (c.headerName || '') : '' })),
    action: actions[actionType], response_code: actionType === 'Block Request' ? Number(responseCode.split(' ')[0]) : null,
    custom_response: customResponse, log_event: logEvent, add_to_reputation: addToReputation,
    source_ip: sourceIP, host_domain: hostDomain, path_prefix: pathPrefix,
    http_method: httpMethod === 'All Methods' ? '' : httpMethod,
  };

  const handleInitiateSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!ruleName.trim()) {
      setError('Rule Name is required. Vui lòng nhập tên Rule.');
      return;
    }
    setIsActivationDialogOpen(true);
  };

  const handleConfirmSave = async (shouldEnable: boolean) => {
    setIsActivationDialogOpen(false);
    setEnabled(shouldEnable);
    await executeCreateRule(shouldEnable);
  };

  const executeCreateRule = async (shouldEnable: boolean) => {
    if (inFlight.current) return;
    const def = {
      ...definition,
      enabled: shouldEnable,
    };
    const payload = JSON.stringify(def);
    if (uncertain && attempt.current?.payload !== payload) { setError('Retry the original submission before changing its content.'); return; }
    if (!attempt.current || attempt.current.payload !== payload) attempt.current = { key: crypto.randomUUID(), payload };
    inFlight.current = true; setBusy(true); setError(''); setFieldErrors({});
    const authToken = getAuthToken();
    try {
      const response = await fetch('/api/v2/rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          'Idempotency-Key': attempt.current.key,
        },
        credentials: 'same-origin',
        body: attempt.current.payload,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        if (response.status === 422 && response.headers.get('content-type')?.includes('application/json')) {
          const validation = await response.json(); setFieldErrors(validation.fields || {});
        }
        setUncertain(response.status >= 500);
        setError(response.status >= 500 ? 'The outcome is uncertain. Retry the same submission; its idempotency key is retained.' : `Rule was not created (${response.status}). Correct the fields or credential and retry.`);
        return;
      }
      const saved = await response.json();
      if (typeof saved.id !== 'string' || !/^\d+$/.test(saved.id) || saved.state !== 'saved') throw new Error('Unexpected create response');
      navigate(`/rules?selected=${saved.id}&after=${BigInt(saved.id) - 1n}`, { state: { createdId: saved.id } });
    } catch {
      setUncertain(true); setError('Connection interrupted or response lost. Retry without changing the form; the same key prevents duplicate creation.');
    } finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <div className="p-6 w-full space-y-6">
      {/* Header */}
      <CreateRuleHeader onScrollToTemplates={handleScrollToTemplates} />
      {error && <div role="alert" className="border border-rose-700 bg-rose-950/30 p-3 text-rose-200"><p>{error}</p><ul>{Object.entries(fieldErrors).map(([field, message]) => <li key={field}><strong>{field}</strong>: {message}</li>)}</ul></div>}

          {/* Form Layout: 2 Columns on desktop */}
          <form onSubmit={handleInitiateSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Left 7 cols: Form sections */}
            <div className="lg:col-span-7 space-y-5">
              <fieldset disabled={busy || uncertain} className="space-y-5 disabled:opacity-70">
              {/* 1. Basic Information */}
              <BasicInfoSection
                name={ruleName}
                setName={setRuleName}
                description={description}
                setDescription={setDescription}
                policy={policy}
                setPolicy={setPolicy}
                priority={priority}
                setPriority={setPriority}
                policyCatalog={policyCatalog}
                isLoadingPolicies={isLoadingPolicies}
              />

              <div className="grid grid-cols-3 gap-3 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 text-xs text-slate-800 dark:text-slate-200">
                <label>Group<select aria-label="Rule group" value={group} onChange={e => setGroup(e.target.value)} className="block w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] p-2 mt-1">{['custom','sqli','xss','traversal','bot','endpoint','authentication'].map(g => <option key={g}>{g}</option>)}</select></label>
                <label>Severity<select aria-label="Severity" value={severity} onChange={e => setSeverity(e.target.value)} className="block w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] p-2 mt-1">{['low','medium','high','critical'].map(s => <option key={s}>{s}</option>)}</select></label>
                <label>Score<input aria-label="Score" type="number" min={0} max={1000} value={score} onChange={e => setScore(Number(e.target.value))} className="block w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] p-2 mt-1" /></label>
              </div>

              {/* 2. Match Conditions */}
              <MatchConditionsSection
                conditions={conditions}
                setConditions={setConditions}
                logicMode={logicMode}
                setLogicMode={setLogicMode}
              />

              {/* 3. Actions */}
              <ActionsSection
                actionType={actionType}
                setActionType={next => { setActionType(next); if (next !== 'Block Request') setCustomResponse(''); }}
                responseCode={responseCode}
                setResponseCode={setResponseCode}
                customResponse={customResponse}
                setCustomResponse={setCustomResponse}
                logEvent={logEvent}
                setLogEvent={setLogEvent}
                addToReputation={addToReputation}
                setAddToReputation={setAddToReputation}
              />

              {/* 4. Scope (Optional) */}
              <ScopeSection
                sourceIP={sourceIP}
                setSourceIP={setSourceIP}
                hostDomain={hostDomain}
                setHostDomain={setHostDomain}
                pathPrefix={pathPrefix}
                setPathPrefix={setPathPrefix}
                httpMethod={httpMethod}
                setHttpMethod={setHttpMethod}
              />
              </fieldset>

              {/* Form Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  disabled={busy || uncertain}
                  onClick={() => navigate('/rules')}
                  className="px-4 py-2 bg-slate-100 dark:bg-[#0E1726] hover:bg-slate-200 dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs font-mono transition-colors cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleInitiateSubmit}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 border border-blue-500 text-white text-xs font-bold font-mono transition-colors cursor-pointer shadow-sm"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{busy ? 'Saving…' : uncertain ? 'Retry same submission' : 'Create Rule'}</span>
                </button>
              </div>
            </div>

            {/* Right 5 cols: Panels */}
            <div className="lg:col-span-5 space-y-5">
              {/* Rule Preview */}
              <RulePreviewPanel definition={definition} />

              {/* Common Rule Templates */}
              <fieldset disabled={busy || uncertain}><RuleTemplatesPanel onSelectTemplate={handleSelectTemplate} /></fieldset>
            </div>
          </form>

          {/* Save Confirmation Dialog */}
          <RuleActivationDialog
            open={isActivationDialogOpen}
            onOpenChange={setIsActivationDialogOpen}
            ruleName={ruleName}
            isSaving={busy}
            onConfirm={handleConfirmSave}
          />
    </div>
  );
}

