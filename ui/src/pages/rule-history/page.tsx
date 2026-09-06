import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { GitCompare, RotateCcw, ArrowLeft, ChevronRight, CheckCircle2, AlertCircle } from 'lucide-react';
import { RuleSummaryCard } from './sections/RuleSummaryCard';
import { VersionHistoryTable } from './sections/VersionHistoryTable';
import { ConfigurationDiffViewer } from './sections/ConfigurationDiffViewer';
import { VersionDetailsPanel } from './sections/VersionDetailsPanel';
import { RestoreConfirmModal } from './sections/RestoreConfirmModal';
import type { RuleVersion } from './types';

export default function RuleHistoryPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ruleIdParam = searchParams.get('id') || 'rule_01H8F3K9Z7';

  // State
  const [ruleName, setRuleName] = useState('block-sql-injection');
  const [ruleId, setRuleId] = useState(ruleIdParam);
  const [policy, setPolicy] = useState('Default WAF Policy');
  const [createdBy, setCreatedBy] = useState('admin');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Initial versions matching user screenshot exactly
  const [versions, setVersions] = useState<RuleVersion[]>([
    {
      version: 3,
      versionLabel: 'v3',
      dateTime: '2025-08-26 15:22:18',
      changedBy: 'admin',
      changeType: 'Logic Update',
      summaryOfChanges: 'Added query parameter detection and updated action settings',
      deploymentStatus: 'Active',
      description: 'Block common SQL injection patterns in URI and query parameters.',
      action: 'Log Only / Monitor',
      responseCode: 403,
      policy: 'Default WAF Policy',
      priority: 100,
      conditions: [
        {
          field: 'Request URI',
          operator: 'Contains (Pattern)',
          value: '(?i)(union|select|insert|drop|or\\s+1=1)',
        },
        {
          field: 'Query Parameter',
          operator: 'Contains (Pattern)',
          value: '(?i)(union|select|insert|drop|or\\s+1=1)',
        },
      ],
      modifiedFields: [
        {
          icon: 'filter',
          title: 'Match Conditions',
          subtext: 'Added: Query Parameter condition',
        },
        {
          icon: 'shield',
          title: 'Action Type',
          subtext: 'Changed: Block Request → Log Only / Monitor',
        },
        {
          icon: 'code',
          title: 'Response Code',
          subtext: 'Changed: 403 → 403 (no change)',
        },
        {
          icon: 'file-text',
          title: 'Description',
          subtext: 'Updated rule description',
        },
      ],
      deploymentInfo: {
        deployedAt: '2025-08-26 15:22:30',
        deployedBy: 'admin',
        environment: 'Production',
        nodes: '3 / 3 nodes',
      },
      auditTrail: [
        {
          title: 'Rule updated',
          subtitle: 'Changes saved',
          actorDate: 'admin • 2025-08-26 15:22:18',
          type: 'blue',
        },
        {
          title: 'Rule deployed',
          subtitle: 'Deployed to 3 nodes',
          actorDate: 'admin • 2025-08-26 15:22:30',
          type: 'green',
        },
      ],
    },
    {
      version: 2,
      versionLabel: 'v2',
      dateTime: '2025-08-24 10:41:02',
      changedBy: 'admin',
      changeType: 'Condition Update',
      summaryOfChanges: 'Added request URI match condition',
      deploymentStatus: 'Archived',
      description: 'Block common SQL injection patterns in URI and query parameters.',
      action: 'Block Request',
      responseCode: 403,
      policy: 'Default WAF Policy',
      priority: 100,
      conditions: [
        {
          field: 'Request URI',
          operator: 'Contains (Pattern)',
          value: '(?i)(union|select|insert|drop|or\\s+1=1)',
        },
      ],
      modifiedFields: [
        {
          icon: 'filter',
          title: 'Match Conditions',
          subtext: 'Added: Request URI condition',
        },
        {
          icon: 'shield',
          title: 'Action Type',
          subtext: 'Block Request',
        },
        {
          icon: 'code',
          title: 'Response Code',
          subtext: '403 Forbidden',
        },
        {
          icon: 'file-text',
          title: 'Description',
          subtext: 'Initial URI inspection scope',
        },
      ],
      deploymentInfo: {
        deployedAt: '2025-08-24 10:42:15',
        deployedBy: 'admin',
        environment: 'Production',
        nodes: '3 / 3 nodes',
      },
      auditTrail: [
        {
          title: 'Rule updated',
          subtitle: 'Changes saved',
          actorDate: 'admin • 2025-08-24 10:41:02',
          type: 'blue',
        },
        {
          title: 'Rule deployed',
          subtitle: 'Deployed to 3 nodes',
          actorDate: 'admin • 2025-08-24 10:42:15',
          type: 'green',
        },
      ],
    },
    {
      version: 1,
      versionLabel: 'v1',
      dateTime: '2025-08-20 10:14:32',
      changedBy: 'admin',
      changeType: 'Initial Creation',
      summaryOfChanges: 'Created base SQL injection detection rule',
      deploymentStatus: 'Archived',
      description: 'Base SQL injection detection rule.',
      action: 'Block Request',
      responseCode: 403,
      policy: 'Default WAF Policy',
      priority: 150,
      conditions: [
        {
          field: 'Request URI',
          operator: 'Contains (Pattern)',
          value: '(?i)(union|select|insert|1=1)',
        },
      ],
      modifiedFields: [
        {
          icon: 'filter',
          title: 'Match Conditions',
          subtext: 'Initial creation',
        },
        {
          icon: 'shield',
          title: 'Action Type',
          subtext: 'Block Request',
        },
        {
          icon: 'code',
          title: 'Response Code',
          subtext: '403 Forbidden',
        },
        {
          icon: 'file-text',
          title: 'Description',
          subtext: 'Initial revision',
        },
      ],
      deploymentInfo: {
        deployedAt: '2025-08-20 10:15:00',
        deployedBy: 'admin',
        environment: 'Production',
        nodes: '3 / 3 nodes',
      },
      auditTrail: [
        {
          title: 'Rule created',
          subtitle: 'Initial revision created',
          actorDate: 'admin • 2025-08-20 10:14:32',
          type: 'blue',
        },
        {
          title: 'Rule deployed',
          subtitle: 'Deployed to 3 nodes',
          actorDate: 'admin • 2025-08-20 10:15:00',
          type: 'green',
        },
      ],
    },
  ]);

  const [selectedVersion, setSelectedVersion] = useState<number>(3);
  const [fromVersion, setFromVersion] = useState<number>(2);
  const [toVersion, setToVersion] = useState<number>(3);

  // Restore Modal State
  const [isRestoreModalOpen, setIsRestoreModalOpen] = useState(false);
  const [restoreTargetVersion, setRestoreTargetVersion] = useState<RuleVersion | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Fetch real history from backend if available
  useEffect(() => {
    async function fetchBackendHistory() {
      try {
        const token = localStorage.getItem('aurora_admin_token') || 'test';
        // Try rule id numeric (e.g. 1) or look up rule
        const numericId = ruleIdParam === 'rule_01H8F3K9Z7' ? 1 : parseInt(ruleIdParam, 10) || 1;
        const res = await fetch(`/api/v1/rules/${numericId}/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.items && data.items.length > 0) {
            // If backend has items, rule name & version can be aligned
            const first = data.items[0];
            if (first.name) setRuleName(first.name);
          }
        }
      } catch (err) {
        console.warn('Could not fetch backend history, using local state snapshot', err);
      }
    }
    fetchBackendHistory();
  }, [ruleIdParam]);

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
    // Scroll smoothly to diff section
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
      // Call backend rollback if available
      const token = localStorage.getItem('aurora_admin_token') || 'test';
      const numericId = ruleIdParam === 'rule_01H8F3K9Z7' ? 1 : parseInt(ruleIdParam, 10) || 1;
      await fetch(`/api/v1/rules/${numericId}/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ target_version: targetVer }),
      }).catch(() => null);

      // Create new version snapshot (e.g. v4)
      const nextVersionNum = Math.max(...versions.map((v) => v.version)) + 1;
      const now = new Date();
      const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);

      const newVersion: RuleVersion = {
        version: nextVersionNum,
        versionLabel: `v${nextVersionNum}`,
        dateTime: dateStr,
        changedBy: 'admin',
        changeType: 'Rollback Restore',
        summaryOfChanges: `Restored configuration snapshot from ${targetObj.versionLabel} (${targetObj.action})`,
        deploymentStatus: 'Active',
        description: targetObj.description,
        action: targetObj.action,
        responseCode: targetObj.responseCode,
        policy: targetObj.policy,
        priority: targetObj.priority,
        conditions: [...targetObj.conditions],
        modifiedFields: [
          {
            icon: 'shield',
            title: 'Rollback Action',
            subtext: `Restored to: ${targetObj.action}`,
          },
          {
            icon: 'filter',
            title: 'Conditions Snapshot',
            subtext: `Restored ${targetObj.conditions.length} condition(s) from ${targetObj.versionLabel}`,
          },
          {
            icon: 'file-text',
            title: 'Audit Source',
            subtext: `Created from revision ${targetObj.versionLabel}`,
          },
        ],
        deploymentInfo: {
          deployedAt: dateStr,
          deployedBy: 'admin',
          environment: 'Production',
          nodes: '3 / 3 nodes',
        },
        auditTrail: [
          {
            title: 'Rule rollback restored',
            subtitle: `Restored from ${targetObj.versionLabel}`,
            actorDate: `admin • ${dateStr}`,
            type: 'blue',
          },
          {
            title: 'Rule deployed',
            subtitle: 'Deployed to 3 nodes',
            actorDate: `admin • ${dateStr}`,
            type: 'green',
          },
        ],
      };

      // Mark all existing versions as Archived
      const updatedVersions = [
        newVersion,
        ...versions.map((v) => ({
          ...v,
          deploymentStatus: 'Archived' as const,
        })),
      ];

      setVersions(updatedVersions);
      setSelectedVersion(nextVersionNum);
      setFromVersion(targetVer);
      setToVersion(nextVersionNum);
      setIsRestoreModalOpen(false);
      setNotification({
        type: 'success',
        message: `Rule configuration restored to version ${targetObj.versionLabel}. Revision v${nextVersionNum} is now active and deployed.`,
      });

      setTimeout(() => setNotification(null), 6000);
    } catch (err) {
      console.error(err);
      setNotification({
        type: 'error',
        message: 'Failed to rollback rule configuration.',
      });
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="p-6 w-full space-y-6">
      {/* Top Breadcrumb & Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          {/* Breadcrumb */}
          <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500 mb-1">
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
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
            Review rule versions, audit changes, and restore previous configurations.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
          <button
            type="button"
            onClick={() => {
              const elem = document.getElementById('configuration-diff-section');
              if (elem) elem.scrollIntoView({ behavior: 'smooth' });
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-xs"
          >
            <GitCompare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Compare Versions</span>
          </button>

          <button
            type="button"
            onClick={() => handleOpenRestoreModal(selectedVersion)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#0E1726] dark:hover:bg-[#152030] border border-slate-200 dark:border-[#1C293D] text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer rounded-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Restore Selected</span>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/edit-rule?id=${ruleId}`)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-xs transition-colors cursor-pointer rounded-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Edit Rule</span>
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {notification && (
        <div
          className={`p-3 border rounded-xs text-xs font-mono flex items-center justify-between transition-all ${
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
        status="Active"
        policy={policy}
        lastModified={currentActiveVersionObj.dateTime}
        createdBy={createdBy}
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
