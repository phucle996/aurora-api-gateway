import React from 'react';
import type { RuleVersion } from '../types';
import {
  FileText,
  Shield,
  Code,
  Layers,
  CheckCircle2,
  Calendar,
  User,
  Activity,
  Server,
} from 'lucide-react';

interface VersionDetailsPanelProps {
  version: RuleVersion;
}

export function VersionDetailsPanel({ version }: VersionDetailsPanelProps) {
  const getBadgeClass = (changeType: string) => {
    switch (changeType) {
      case 'Logic Update':
        return 'bg-primary/10 text-primary border border-primary/20';
      case 'Condition Update':
        return 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900/60';
      case 'Initial Creation':
        return 'bg-muted text-foreground border border-border';
      case 'Rollback Restore':
        return 'bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/50 dark:text-purple-400 dark:border-purple-900/60';
      default:
        return 'bg-muted text-foreground border border-border';
    }
  };

  const getFieldIcon = (iconName: string) => {
    switch (iconName) {
      case 'shield':
        return <Shield className="w-3.5 h-3.5 text-primary shrink-0" />;
      case 'code':
        return <Code className="w-3.5 h-3.5 text-primary shrink-0" />;
      case 'layers':
      case 'filter':
        return <Layers className="w-3.5 h-3.5 text-primary shrink-0" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-primary shrink-0" />;
    }
  };

  return (
    <div className="bg-card border border-border rounded-xs p-4 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Version Details
        </h2>
        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono font-bold text-xs border border-primary/20">
          {version.versionLabel}
        </span>
      </div>

      {/* Metadata Attributes */}
      <div className="space-y-2 text-xs font-sans">
        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400 text-[11px]">Change Type</span>
          <span
            className={`px-2 py-0.5 rounded-xs text-[10px] font-medium ${getBadgeClass(
              version.changeType
            )}`}
          >
            {version.changeType}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400 text-[11px]">Modified At</span>
          <span className="text-slate-800 dark:text-slate-200 text-[11px] font-mono">
            {version.dateTime}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400 text-[11px]">Changed By</span>
          <span className="text-slate-800 dark:text-slate-200">{version.changedBy}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-slate-500 dark:text-slate-400 text-[11px]">Deployment Status</span>
          <div className="flex items-center gap-1.5 font-medium">
            {version.deploymentStatus === 'Active' ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
                  Active
                </span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 inline-block" />
                <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                  Archived
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Change Summary */}
      <div>
        <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
          Change Summary
        </h3>
        <div className="p-3 bg-muted/40 border border-border rounded-xs text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-sans text-[11px]">
          {version.summaryOfChanges}
        </div>
      </div>

      {/* Modified Fields */}
      <div>
        <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2.5">
          Modified Fields
        </h3>
        <div className="space-y-2.5 font-sans">
          {version.modifiedFields.map((field, idx) => (
            <div key={idx} className="flex items-start gap-2 text-xs">
              <div className="p-1 bg-primary/10 border border-primary/20 rounded-xs">
                {getFieldIcon(field.icon)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                  {field.title}
                </div>
                <div className="text-slate-500 dark:text-slate-400 text-[11px] truncate font-mono">
                  {field.subtext}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Deployment Information */}
      <div>
        <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2.5">
          Deployment Information
        </h3>
        <div className="space-y-1.5 text-xs font-sans">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Deployed At</span>
            <span className="text-slate-700 dark:text-slate-300 text-[11px] font-mono">
              {version.deploymentInfo.deployedAt}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Deployed By</span>
            <span className="text-slate-700 dark:text-slate-300">
              {version.deploymentInfo.deployedBy}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Environment</span>
            <span className="text-slate-700 dark:text-slate-300">
              {version.deploymentInfo.environment}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">Nodes</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium font-mono">
              {version.deploymentInfo.nodes}
            </span>
          </div>
        </div>
      </div>

      {/* Audit Trail */}
      <div>
        <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2.5">
          Audit Trail
        </h3>
        <div className="relative pl-5 space-y-4 before:content-[''] before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-[1px] before:bg-border">
          {version.auditTrail.map((audit, idx) => (
            <div key={idx} className="relative">
              <span
                className={`absolute -left-5 top-1 w-2.5 h-2.5 rounded-full ring-2 ring-card ${
                  audit.type === 'green' ? 'bg-emerald-500' : 'bg-primary'
                }`}
              />
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-800 dark:text-slate-200 text-[11px]">
                  {audit.title}
                </span>
                <span className="text-slate-500 dark:text-slate-400 text-[10px] font-mono">
                  {audit.subtitle}
                </span>
              </div>
              <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                {audit.actorDate}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
