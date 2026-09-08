import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { EditRuleHeader } from './sections/EditRuleHeader';
import { EditBasicInfoSection } from './sections/EditBasicInfoSection';
import { EditMatchConditionsSection } from './sections/EditMatchConditionsSection';
import { EditActionsSection } from './sections/EditActionsSection';
import { EditScopeSection } from './sections/EditScopeSection';
import { EditRulePreviewPanel } from './sections/EditRulePreviewPanel';
import { EditRuleTesterPanel } from './sections/EditRuleTesterPanel';
import { EditRuleInfoPanel } from './sections/EditRuleInfoPanel';
import { EditRuleActivationDialog } from './sections/EditRuleActivationDialog';
import { DeleteRuleDialog } from './sections/DeleteRuleDialog';
import type { Condition } from '../create-rule/sections/MatchConditionsSection';
import { Save, AlertCircle, Loader2 } from 'lucide-react';
import { rulesApi, type RuleDetailResponse, type UpdateRuleDefinitionPayload } from '../../lib/api/rules';

const fields: Record<string, string> = {
  'Request URI': 'uri_raw',
  'Request Path': 'path',
  'Query String': 'query',
  'Request Header': 'header',
  'Request Body': 'body',
  'Client IP': 'client_ip',
  'HTTP Method': 'method',
};
const operators: Record<string, string> = {
  'Contains (Pattern)': 'contains',
  'Equals': 'equals',
  'Starts With': 'starts_with',
  'Ends With': 'ends_with',
  'Regex Match': 'regex',
  'In CIDR Range': 'cidr',
};
const actions: Record<string, string> = {
  'Block Request': 'block',
  'Allow Request': 'allow',
  'Log Only / Monitor': 'log',
};

const dbFieldsToUi: Record<string, string> = {
  uri_raw: 'Request URI',
  path: 'Request Path',
  query: 'Query String',
  header: 'Request Header',
  body: 'Request Body',
  client_ip: 'Client IP',
  method: 'HTTP Method',
};
const dbOperatorsToUi: Record<string, string> = {
  contains: 'Contains (Pattern)',
  equals: 'Equals',
  starts_with: 'Starts With',
  ends_with: 'Ends With',
  regex: 'Regex Match',
  cidr: 'In CIDR Range',
};
const dbActionsToUi: Record<string, string> = {
  block: 'Block Request',
  allow: 'Allow Request',
  log: 'Log Only / Monitor',
};

export default function EditRulePage() {
  const navigate = useNavigate();
  const saveAttempt = useRef<{payload:string;key:string}|null>(null);
  const savingRef=useRef(false);
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const ruleId = routeId || searchParams.get('id') || '';

  const generation = useRef(0);
  const deletingRef = useRef(false);

  // Loading & Error States
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [ruleDetail, setRuleDetail] = useState<RuleDetailResponse | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number>(1);
  const [retry, setRetry] = useState(0);

  // Form states
  const [ruleName, setRuleName] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(100);
  const [group, setGroup] = useState('custom');
  const [severity, setSeverity] = useState('medium');
  const [score, setScore] = useState(0);

  const [conditions, setConditions] = useState<Condition[]>([]);
  const [logicMode, setLogicMode] = useState<'ALL' | 'ANY'>('ALL');

  const [actionType, setActionType] = useState('Block Request');
  const [responseCode, setResponseCode] = useState('403');
  const [customResponse, setCustomResponse] = useState('');
  const [logEvent, setLogEvent] = useState(true);
  const [addToReputation, setAddToReputation] = useState(false);

  const [sourceIP, setSourceIP] = useState('');
  const [hostDomain, setHostDomain] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [httpMethod, setHttpMethod] = useState('All Methods');

  const [isSaving, setIsSaving] = useState(false);
  const [isActivationDialogOpen, setIsActivationDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch real rule detail from backend
  useEffect(() => {
    ++generation.current;
    setSaveError('');
    setRuleDetail(null);
    setIsActivationDialogOpen(false);
    setIsDeleteDialogOpen(false);
    saveAttempt.current = null;
    if (!ruleId) {
      setLoadError('No rule ID specified.');
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    setLoadError('');
    rulesApi
      .getById(ruleId)
      .then((data) => {
        if (!active) return;
        setRuleDetail(data);
        setCurrentVersion(data.version || 1);
        setRuleName(data.name || '');
        setDescription(data.description || '');
        setGroup(data.group || 'custom');
        setSeverity(data.severity || 'medium');
        setScore(data.score ?? 0);
        setPriority(data.priority ?? 100);
        setEnabled(data.enabled ?? true);
        setLogicMode(data.logic_mode?.toUpperCase() === 'ANY' ? 'ANY' : 'ALL');
        setActionType(dbActionsToUi[data.action] || 'Block Request');
        setResponseCode(String(data.response_code ?? 403));
        setCustomResponse(data.custom_response || '');
        setLogEvent(data.log_event !== false);
        setAddToReputation(Boolean(data.add_to_reputation));
        setSourceIP(data.source_ip || '');
        setHostDomain(data.host_domain || '');
        setPathPrefix(data.path_prefix || '');
        setHttpMethod(data.http_method || 'All Methods');

        if (Array.isArray(data.conditions) && data.conditions.length > 0) {
          setConditions(
            data.conditions.map((c, i) => ({
              id: `cond-${i + 1}`,
              field: dbFieldsToUi[c.field] || c.field || 'Request URI',
              operator: dbOperatorsToUi[c.operator] || c.operator || 'Contains (Pattern)',
              value: c.value || '',
              headerName: c.header_name || '',
            }))
          );
        } else if (data.path) {
          setConditions([
            {
              id: 'cond-1',
              field: 'Request Path',
              operator: 'Equals',
              value: data.path,
            },
          ]);
        } else {
          throw new Error('Saved rule has no conditions. Refusing to replace them with a default pattern.');
        }
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : `Failed to load rule #${ruleId}`);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      ++generation.current;
    };
  }, [ruleId, retry]);

  const draftDefinition: UpdateRuleDefinitionPayload = {
        expected_version: currentVersion,
        name: ruleName.trim(),
        description,
        group,
        severity,
        score,
        enabled,
        priority,
        policy_id: null,
        logic_mode: logicMode.toLowerCase() as 'all' | 'any',
        conditions: conditions.map(c => ({
          field: fields[c.field] || c.field, operator: operators[c.operator] || c.operator,
          value: c.value, header_name: c.field === 'Request Header' ? (c.headerName || '') : '',
        })),
        action: (actions[actionType] || 'block') as 'allow' | 'log' | 'block',
        response_code: actionType === 'Block Request' ? Number(responseCode) : null,
        custom_response: actionType === 'Block Request' ? customResponse : '',
        log_event: logEvent,
        add_to_reputation: addToReputation,
        source_ip: sourceIP.trim(),
        host_domain: hostDomain.trim(),
        path_prefix: pathPrefix.trim(),
        http_method: httpMethod === 'All Methods' ? '' : httpMethod,
      };

  const handleInitiateSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (savingRef.current || deletingRef.current) return;
    if (!ruleName.trim()) {
      setSaveError('Rule Name is required. Vui lòng nhập tên Rule.');
      return;
    }
    setSaveError('');
    setIsActivationDialogOpen(true);
  };

  const handleConfirmSave = async (shouldEnable: boolean) => {
    if(savingRef.current || deletingRef.current || !ruleDetail)return;
    const seq = generation.current;
    savingRef.current=true;
    setIsActivationDialogOpen(false);
    setIsSaving(true);
    setSaveError('');

    try {
      const payload = { ...draftDefinition, enabled: shouldEnable };
      const serialized=JSON.stringify(payload);
      if(saveAttempt.current?.payload!==serialized)saveAttempt.current={payload:serialized,key:crypto.randomUUID()};
      await rulesApi.updateDefinition(ruleId,payload,saveAttempt.current.key);

      if (seq !== generation.current) return;
      navigate(`/rules?selected=${encodeURIComponent(ruleId)}`, {
        state: { updatedId: ruleId },
      });
    } catch (err: any) {
      if (seq === generation.current) setSaveError(err?.message || 'Failed to update rule. The rule might have been modified concurrently.');
    } finally {
      savingRef.current=false;
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (savingRef.current || deletingRef.current) return;
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (savingRef.current || deletingRef.current || !ruleDetail) return;
    deletingRef.current = true;
    const seq = generation.current;
    setIsDeleting(true);
    try {
      await rulesApi.delete(ruleId, currentVersion);
      if (seq !== generation.current) return;
      setIsDeleteDialogOpen(false);
      navigate('/rules');
    } catch (err: any) {
      if (seq === generation.current) alert(err?.message || 'Delete failed. If the rule is assigned to a policy, remove it from the policy first.');
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-12 w-full flex flex-col items-center justify-center space-y-3 font-sans text-xs text-slate-500">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600 dark:text-blue-400" />
        <p>Loading rule #{ruleId} from server…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-8 w-full max-w-xl mx-auto space-y-4 font-sans text-xs">
        <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-sm text-rose-700 dark:text-rose-300 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="font-semibold text-sm">Cannot load rule</h2>
            <p>{loadError}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRetry((c) => c + 1)}
            className="px-3.5 py-1.5 bg-muted hover:bg-accent border border-border rounded-xs text-foreground transition-colors cursor-pointer"
          >
            Retry
          </button>
          <Link
            to="/rules"
            className="px-3.5 py-1.5 bg-muted hover:bg-accent border border-border rounded-xs text-foreground transition-colors"
          >
            Back to Rules
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 w-full space-y-6">
      {/* Header */}
      <EditRuleHeader
        ruleId={ruleId}
        onDelete={handleDelete}
        onSave={handleInitiateSave}
        isSaving={isSaving || isDeleting}
      />

      {saveError && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-mono rounded-xs flex items-center justify-between">
          <span>{saveError}</span>
          <button
            type="button"
            onClick={() => setSaveError('')}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-3"
          >
            ✕
          </button>
        </div>
      )}

      {/* Form Layout: 2 Columns on desktop */}
      <form onSubmit={handleInitiateSave}>
      <fieldset disabled={isSaving || isDeleting}
        className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
      >
        {/* Left 7 cols: Form sections */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. Basic Information */}
          <EditBasicInfoSection
            ruleId={ruleId}
            name={ruleName}
            setName={setRuleName}
            description={description}
            setDescription={setDescription}
            priority={priority}
            setPriority={setPriority}
          />

          {/* Group, Severity, Score */}
          <div className="grid grid-cols-3 gap-3 bg-card border border-border p-4 text-xs font-mono text-foreground">
            <div>
              <label className="block text-muted-foreground mb-1 text-[11px]">Group</label>
              <select
                aria-label="Rule group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="w-full bg-background border border-input p-2 text-foreground focus:outline-none focus:border-primary"
              >
                {['custom', 'sqli', 'xss', 'traversal', 'bot', 'endpoint', 'authentication'].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-muted-foreground mb-1 text-[11px]">Severity</label>
              <select
                aria-label="Severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full bg-background border border-input p-2 text-foreground focus:outline-none focus:border-primary"
              >
                {['low', 'medium', 'high', 'critical'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-muted-foreground mb-1 text-[11px]">Score</label>
              <input
                aria-label="Score"
                type="number"
                min={0}
                max={1000}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="w-full bg-background border border-input p-2 text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* 2. Match Conditions */}
          <EditMatchConditionsSection
            conditions={conditions}
            setConditions={setConditions}
            logicMode={logicMode}
            setLogicMode={setLogicMode}
          />

          {/* 3. Actions */}
          <EditActionsSection
            actionType={actionType}
            setActionType={setActionType}
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
          <EditScopeSection
            sourceIP={sourceIP}
            setSourceIP={setSourceIP}
            hostDomain={hostDomain}
            setHostDomain={setHostDomain}
            pathPrefix={pathPrefix}
            setPathPrefix={setPathPrefix}
            httpMethod={httpMethod}
            setHttpMethod={setHttpMethod}
          />

          {/* Form Action Buttons */}
          <div className="flex items-center justify-between pt-2 font-sans">
            <button
              type="button"
              onClick={() => navigate('/rules')}
              className="px-4 py-2 bg-muted hover:bg-accent border border-border text-foreground text-xs rounded-sm transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleInitiateSave}
              className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 border border-primary text-primary-foreground text-xs font-semibold rounded-sm transition-colors cursor-pointer shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>

        {/* Right 5 cols: Panels */}
        <div className="lg:col-span-5 space-y-5">
          {/* Rule Preview */}
          <EditRulePreviewPanel definition={draftDefinition} />

          <EditRuleTesterPanel
            conditions={draftDefinition.conditions}
            logicMode={draftDefinition.logic_mode}
            action={draftDefinition.action}
            responseCode={draftDefinition.response_code ?? 0}
            ruleId={ruleId}
          />

          {/* Rule Information with real database metadata */}
          <EditRuleInfoPanel
            createdAt={ruleDetail?.created_at}
            createdBy={ruleDetail?.created_by}
            updatedAt={ruleDetail?.updated_at}
            version={currentVersion}
            runtimeReady={ruleDetail?.runtime_ready}
            runtimeIssues={ruleDetail?.runtime_issues}
            assignedPolicies={ruleDetail?.assigned_policies}
            group={group}
            severity={severity}
          />
        </div>
      </fieldset>
      </form>

      {/* Save Confirmation Dialog */}
      <EditRuleActivationDialog
        open={isActivationDialogOpen}
        onOpenChange={setIsActivationDialogOpen}
        ruleName={ruleName}
        isSaving={isSaving || isDeleting}
        onConfirm={handleConfirmSave}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteRuleDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirmDelete={handleConfirmDelete}
        ruleName={ruleName}
        ruleId={ruleId}
        isDeleting={isDeleting}
      />
    </div>
  );
}

