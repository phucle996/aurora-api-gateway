import React, { useEffect, useState } from 'react';
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
import { policiesApi, type PolicyCatalogItem } from '../../lib/api/policies';
import { rulesApi, type RuleDetailResponse } from '../../lib/api/rules';

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
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const ruleId = routeId || searchParams.get('id') || '';

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
  const [policy, setPolicy] = useState('');
  const [policyCatalog, setPolicyCatalog] = useState<PolicyCatalogItem[]>([]);
  const [isLoadingPolicies, setIsLoadingPolicies] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [priority, setPriority] = useState(100);
  const [group, setGroup] = useState('custom');
  const [severity, setSeverity] = useState('medium');
  const [score, setScore] = useState(0);

  const [conditions, setConditions] = useState<Condition[]>([]);
  const [logicMode, setLogicMode] = useState<'ALL' | 'ANY'>('ALL');

  const [actionType, setActionType] = useState('Block Request');
  const [responseCode, setResponseCode] = useState('403 Forbidden');
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

  // Load policy catalog
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

  // Fetch real rule detail from backend
  useEffect(() => {
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
        setResponseCode(data.response_code ? `${data.response_code} ${data.response_code === 403 ? 'Forbidden' : 'Error'}` : '403 Forbidden');
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
              operator: 'Starts With',
              value: data.path,
            },
          ]);
        } else {
          setConditions([
            {
              id: 'cond-1',
              field: 'Request URI',
              operator: 'Contains (Pattern)',
              value: '.*',
            },
          ]);
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
    };
  }, [ruleId, retry]);

  const handleInitiateSave = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!ruleName.trim()) {
      setSaveError('Rule Name is required. Vui lòng nhập tên Rule.');
      return;
    }
    setSaveError('');
    setIsActivationDialogOpen(true);
  };

  const handleConfirmSave = async (shouldEnable: boolean) => {
    setIsActivationDialogOpen(false);
    setIsSaving(true);
    setSaveError('');

    try {
      const codeNum = actionType === 'Block Request' ? Number(responseCode.split(' ')[0]) || 403 : null;
      const payloadConditions = conditions.map((c) => ({
        field: fields[c.field] || c.field,
        operator: operators[c.operator] || c.operator,
        value: c.value,
        header_name: c.field === 'Request Header' ? (c.headerName || '') : '',
      }));

      await rulesApi.updateDefinition(ruleId, {
        expected_version: currentVersion,
        name: ruleName.trim(),
        description: description.trim(),
        group,
        severity,
        score,
        enabled: shouldEnable,
        priority,
        policy_id: null,
        logic_mode: logicMode.toLowerCase() as 'all' | 'any',
        conditions: payloadConditions,
        action: (actions[actionType] || 'block') as 'allow' | 'log' | 'block',
        response_code: codeNum,
        custom_response: customResponse.trim(),
        log_event: logEvent,
        add_to_reputation: addToReputation,
        source_ip: sourceIP.trim(),
        host_domain: hostDomain.trim(),
        path_prefix: pathPrefix.trim(),
        http_method: httpMethod === 'All Methods' ? '' : httpMethod,
      });

      navigate(`/rules?selected=${encodeURIComponent(ruleId)}`, {
        state: { updatedId: ruleId },
      });
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to update rule. The rule might have been modified concurrently.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      await rulesApi.delete(ruleId, currentVersion);
      setIsDeleteDialogOpen(false);
      navigate('/rules');
    } catch (err: any) {
      alert(err?.message || 'Delete failed. If the rule is assigned to a policy, remove it from the policy first.');
    } finally {
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
            onClick={() => setRetry((r) => r + 1)}
            className="px-3.5 py-1.5 bg-blue-600 text-white rounded-xs font-semibold hover:bg-blue-500 cursor-pointer"
          >
            Retry
          </button>
          <Link
            to="/rules"
            className="px-3.5 py-1.5 bg-slate-100 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] rounded-xs text-slate-700 dark:text-slate-300 hover:text-white"
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
        isSaving={isSaving}
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
      <form
        onSubmit={handleInitiateSave}
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
            policy={policy}
            setPolicy={setPolicy}
            priority={priority}
            setPriority={setPriority}
            policyCatalog={policyCatalog}
            isLoadingPolicies={isLoadingPolicies}
          />

          {/* Group, Severity, Score */}
          <div className="grid grid-cols-3 gap-3 bg-white dark:bg-[#0B1320] border border-slate-200 dark:border-[#152030] p-4 text-xs font-mono text-slate-800 dark:text-slate-200">
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1 text-[11px]">Group</label>
              <select
                aria-label="Rule group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] p-2"
              >
                {['custom', 'sqli', 'xss', 'traversal', 'bot', 'endpoint', 'authentication'].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1 text-[11px]">Severity</label>
              <select
                aria-label="Severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] p-2"
              >
                {['low', 'medium', 'high', 'critical'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-500 dark:text-slate-400 mb-1 text-[11px]">Score</label>
              <input
                aria-label="Score"
                type="number"
                min={0}
                max={1000}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-[#0E1726] border border-slate-200 dark:border-[#1C293D] p-2"
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
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white text-xs rounded-sm transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={isSaving}
              onClick={handleInitiateSave}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 border border-blue-500 text-white text-xs font-semibold rounded-sm transition-colors cursor-pointer shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </div>

        {/* Right 5 cols: Panels */}
        <div className="lg:col-span-5 space-y-5">
          {/* Rule Preview */}
          <EditRulePreviewPanel
            name={ruleName}
            policy={policy}
            priority={priority}
            conditions={conditions}
            responseCode={responseCode}
          />

          {/* Test Rule with live backend */}
          <EditRuleTesterPanel conditions={conditions} logicMode={logicMode} ruleId={ruleId} />

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
      </form>

      {/* Save Confirmation Dialog */}
      <EditRuleActivationDialog
        open={isActivationDialogOpen}
        onOpenChange={setIsActivationDialogOpen}
        ruleName={ruleName}
        isSaving={isSaving}
        onConfirm={handleConfirmSave}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteRuleDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirmDelete={handleConfirmDelete}
        ruleName={ruleName}
        isDeleting={isDeleting}
      />
    </div>
  );
}

