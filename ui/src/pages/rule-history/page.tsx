import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { GitCompare, RotateCcw, ArrowLeft, ChevronRight, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { rulesApi, type RuleDetailResponse } from '../../lib/api/rules';
import { RuleSummaryCard } from './sections/RuleSummaryCard';
import { VersionHistoryTable } from './sections/VersionHistoryTable';
import { ConfigurationDiffViewer } from './sections/ConfigurationDiffViewer';
import { VersionDetailsPanel } from './sections/VersionDetailsPanel';
import { RestoreConfirmModal } from './sections/RestoreConfirmModal';
import type { RuleVersion, RuleConditionItem, ModifiedFieldItem, DeploymentInfo, AuditTrailItem } from './types';

export default function RuleHistoryPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ruleId = routeId || searchParams.get('id') || '';

  // State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleDetail, setRuleDetail] = useState<RuleDetailResponse | null>(null);
  const [versions, setVersions] = useState<RuleVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(1);
  const [fromVersion, setFromVersion] = useState<number>(1);
  const [toVersion, setToVersion] = useState<number>(1);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Restore Modal State
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [restoreTargetVersion, setRestoreTargetVersion] = useState<RuleVersion | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const loadData = useCallback(async () => {
    if (!ruleId) {
      setLoading(false);
      setError('No Rule ID specified. Please select a rule from the Rules catalog.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [detailRes, historyRes] = await Promise.all([
        rulesApi.getById(ruleId).catch(() => null),
        rulesApi.getHistory(ruleId).catch(() => null),
      ]);

      if (!detailRes && (!historyRes || !historyRes.items || historyRes.items.length === 0)) {
        setError(`Rule "${ruleId}" not found or has no revision history.`);
        setLoading(false);
        return;
      }

      if (detailRes) {
        setRuleDetail(detailRes);
      }

      const items = historyRes?.items || [];
      if (items.length > 0) {
        const activeVer = detailRes?.version ?? items[0].version;
        const mappedVersions: RuleVersion[] = items.map((item) => {
          let conditions: RuleConditionItem[] = [];
          if (item.conditions_json) {
            try {
              const parsed = JSON.parse(item.conditions_json);
              if (Array.isArray(parsed)) {
                conditions = parsed.map((c: any) => ({
                  field: c.field || c.Field || 'uri',
                  operator: c.operator || c.Operator || 'equals',
                  value: c.value || c.Value || '',
                  headerName: c.header_name || c.HeaderName || undefined,
                }));
              }
            } catch (e) {
              console.warn('Failed to parse conditions_json', e);
            }
          }
          if (conditions.length === 0 && item.path) {
            conditions = [{ field: 'path', operator: 'equals', value: item.path }];
          }

          const isInitial = item.version === 1;
          const isRollback =
            (item.description && item.description.toLowerCase().includes('rollback')) ||
            item.actor === 'rollback';
          const changeType = isInitial
            ? 'Initial Creation'
            : isRollback
            ? 'Rollback Restore'
            : 'Logic Update';

          const summaryOfChanges = isInitial
            ? `Initial rule creation (${item.name})`
            : isRollback
            ? item.description || 'Rolled back configuration'
            : `Updated action to ${item.action.toUpperCase()} with ${conditions.length} condition(s)`;

          const dateFormatted = item.updated_at
            ? item.updated_at.replace('T', ' ').substring(0, 19)
            : '—';

          const modifiedFields: ModifiedFieldItem[] = [
            {
              icon: 'shield',
              title: 'Action Type',
              subtext: `Action: ${item.action}`,
            },
            {
              icon: 'filter',
              title: 'Match Conditions',
              subtext: `${conditions.length} condition(s) configured`,
            },
            {
              icon: 'code',
              title: 'Response Code',
              subtext: `HTTP ${item.response_code || 403}`,
            },
            {
              icon: 'file-text',
              title: 'Description',
              subtext: item.description || 'No description provided',
            },
          ];

          const deploymentInfo: DeploymentInfo = {
            deployedAt: dateFormatted,
            deployedBy: item.actor || 'system',
            environment: 'Production',
            nodes: 'Active Cluster',
          };

          const auditTrail: AuditTrailItem[] = [
            {
              title: isInitial ? 'Rule created' : 'Rule updated',
              subtitle: 'Changes saved to revision history',
              actorDate: `${item.actor || 'system'} • ${dateFormatted}`,
              type: 'blue',
            },
            {
              title: 'Revision committed',
              subtitle: `Revision v${item.version} recorded`,
              actorDate: `${item.actor || 'system'} • ${dateFormatted}`,
              type: 'green',
            },
          ];

          return {
            version: item.version,
            versionLabel: `v${item.version}`,
            dateTime: dateFormatted,
            changedBy: item.actor || 'system',
            changeType,
            summaryOfChanges,
            deploymentStatus: item.version === activeVer ? 'Active' : 'Archived',
            description: item.description || item.name,
            action: item.action,
            responseCode: item.response_code || 403,
            policy:
              detailRes?.assigned_policies && detailRes.assigned_policies > 0
                ? `${detailRes.assigned_policies} active ${detailRes.assigned_policies === 1 ? 'policy' : 'policies'}`
                : 'Default WAF Policy',
            priority: item.priority || 100,
            conditions,
            modifiedFields,
            deploymentInfo,
            auditTrail,
            rawJson: JSON.stringify(item, null, 2),
          };
        });

        setVersions(mappedVersions);
        setSelectedVersion(mappedVersions[0].version);
        setToVersion(mappedVersions[0].version);
        setFromVersion(
          mappedVersions.length > 1 ? mappedVersions[1].version : mappedVersions[0].version
        );
      } else if (detailRes) {
        // Fallback when rule exists but history records table has only the current state
        const dateFormatted = detailRes.created_at
          ? detailRes.created_at.replace('T', ' ').substring(0, 19)
          : '—';
        const singleVersion: RuleVersion = {
          version: detailRes.version || 1,
          versionLabel: `v${detailRes.version || 1}`,
          dateTime: dateFormatted,
          changedBy: detailRes.created_by || 'system',
          changeType: 'Initial Creation',
          summaryOfChanges: `Initial creation of rule (${detailRes.name})`,
          deploymentStatus: 'Active',
          description: detailRes.description || detailRes.name,
          action: detailRes.action,
          responseCode: detailRes.response_code || 403,
          policy:
            detailRes.assigned_policies && detailRes.assigned_policies > 0
              ? `${detailRes.assigned_policies} active ${detailRes.assigned_policies === 1 ? 'policy' : 'policies'}`
              : 'Default WAF Policy',
          priority: detailRes.priority || 100,
          conditions: (detailRes.conditions || []).map((c) => ({
            field: c.field,
            operator: c.operator,
            value: c.value,
            headerName: c.header_name,
          })),
          modifiedFields: [
            {
              icon: 'shield',
              title: 'Action Type',
              subtext: `Action: ${detailRes.action}`,
            },
            {
              icon: 'filter',
              title: 'Match Conditions',
              subtext: `${detailRes.conditions?.length || 0} condition(s)`,
            },
          ],
          deploymentInfo: {
            deployedAt: dateFormatted,
            deployedBy: detailRes.created_by || 'system',
            environment: 'Production',
            nodes: 'Active Cluster',
          },
          auditTrail: [
            {
              title: 'Rule created',
              subtitle: 'Initial revision created',
              actorDate: `${detailRes.created_by || 'system'} • ${dateFormatted}`,
              type: 'blue',
            },
          ],
        };
        setVersions([singleVersion]);
        setSelectedVersion(singleVersion.version);
        setFromVersion(singleVersion.version);
        setToVersion(singleVersion.version);
      }
    } catch (err: any) {
      console.error('Failed to load rule history:', err);
      setError(err?.message || 'Failed to load rule history');
    } finally {
      setLoading(false);
    }
  }, [ruleId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentActiveVersionObj =
    versions.find((v) => v.deploymentStatus === 'Active') || versions[0];
  const selectedVersionObj =
    versions.find((v) => v.version === selectedVersion) || versions[0];

  const handleSelectVersion = (vNum: number) => {
    setSelectedVersion(vNum);
    setToVersion(vNum);
  };

  const handleCompareVersion = (vNum: number) => {
    setFromVersion(vNum);
    const diffElem = document.getElementById('configuration-diff-section');
    if (diffElem) {
      diffElem.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleOpenRestoreModal = (vNum: number) => {
    const target = versions.find((v) => v.version === vNum);
    if (target) {
      setRestoreTargetVersion(target);
      setIsRestoreModalOpen(true);
    }
  };

  const handleConfirmRestore = async (targetVer: number) => {
    setIsRestoring(true);
    const targetObj = versions.find((v) => v.version === targetVer);
    if (!targetObj) {
      setIsRestoring(false);
      return;
    }

    try {
      const currentVersion = currentActiveVersionObj?.version || (versions[0]?.version) || 1;
      await rulesApi.rollback(ruleId, targetVer, currentVersion);

      setIsRestoreModalOpen(false);
      setNotification({
        type: 'success',
        message: `Rule configuration successfully restored to version ${targetObj.versionLabel}. A new active revision has been created.`,
      });

      await loadData();
      setTimeout(() => setNotification(null), 6000);
    } catch (err: any) {
      console.error(err);
      setNotification({
        type: 'error',
        message: err?.response?.data || err?.message || 'Failed to rollback rule configuration.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] gap-3 text-slate-500 dark:text-slate-400 font-sans text-xs">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span>Loading rule history...</span>
      </div>
    );
  }

  if (error || versions.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto mt-12 font-sans">
        <div className="p-6 bg-card border border-border rounded-xs text-center space-y-4 shadow-sm">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            History Unavailable
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {error || 'No versions recorded for this rule.'}
          </p>
          <div className="pt-2">
            <Link
              to="/rules"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs rounded-xs transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Security Rules</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const ruleName = ruleDetail?.name || versions[0]?.description || 'rule';
  const policyName =
    ruleDetail?.assigned_policies && ruleDetail.assigned_policies > 0
      ? `${ruleDetail.assigned_policies} active ${ruleDetail.assigned_policies === 1 ? 'policy' : 'policies'}`
      : 'Unassigned';
  const ruleStatus = ruleDetail ? (ruleDetail.enabled ? 'Active' : 'Inactive') : 'Active';
  const ruleCreatedBy = ruleDetail?.created_by || versions[versions.length - 1]?.changedBy || 'system';

  return (
    <div className="p-6 w-full space-y-6">
      {/* Top Breadcrumb & Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs font-sans text-slate-500 mb-1">
            <Link
              to="/rules"
              className="hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
            >
              Rules
            </Link>
            <ChevronRight className="w-3 h-3 text-slate-400 dark:text-slate-600" />
            <span className="text-slate-700 dark:text-slate-300">
              View Rule History
            </span>
          </div>

          {/* Title & Subtitle */}
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
            Rule History
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-sans">
            Review rule versions, audit changes, and restore previous configurations.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 font-sans text-xs">
          <button
            type="button"
            onClick={() => {
              const elem = document.getElementById('configuration-diff-section');
              if (elem) elem.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent border border-border text-foreground transition-colors cursor-pointer rounded-xs"
          >
            <GitCompare className="w-3.5 h-3.5 text-primary" />
            <span>Compare Versions</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenRestoreModal(selectedVersion)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-accent border border-border text-foreground transition-colors cursor-pointer rounded-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Restore Selected</span>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/edit-rule?id=${ruleId}`)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-xs transition-colors cursor-pointer rounded-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Edit Rule</span>
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          className={`p-3 border rounded-xs text-xs font-sans flex items-center justify-between transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-4 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Rule Summary */}
      <RuleSummaryCard
        ruleName={ruleName}
        ruleId={ruleId}
        currentVersion={currentActiveVersionObj.versionLabel}
        status={ruleStatus}
        policy={policyName}
        lastModified={currentActiveVersionObj.dateTime}
        createdBy={ruleCreatedBy}
      />

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column (8 cols): Version History Table & Configuration Diff */}
        <div className="lg:col-span-8 space-y-5">
          {/* Version History Table */}
          <VersionHistoryTable
            versions={versions}
            selectedVersion={selectedVersion}
            onSelectVersion={handleSelectVersion}
            onCompareVersion={handleCompareVersion}
            onRestoreVersion={handleOpenRestoreModal}
          />

          {/* Configuration Diff Viewer */}
          <ConfigurationDiffViewer
            versions={versions}
            fromVersion={fromVersion}
            toVersion={toVersion}
            ruleName={ruleName}
            onChangeFromVersion={setFromVersion}
            onChangeToVersion={setToVersion}
          />
        </div>

        {/* Right Column (4 cols): Version Details & Audit Trail */}
        <div className="lg:col-span-4">
          <VersionDetailsPanel version={selectedVersionObj} />
        </div>
      </div>

      {/* Rollback / Restore Modal */}
      <RestoreConfirmModal
        isOpen={isRestoreModalOpen}
        onClose={() => setIsRestoreModalOpen(false)}
        onConfirm={handleConfirmRestore}
        targetVersion={restoreTargetVersion}
        nextVersionNumber={Math.max(...versions.map((v) => v.version)) + 1}
        isRestoring={isRestoring}
      />
    </div>
  );
}
