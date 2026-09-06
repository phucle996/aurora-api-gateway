import React, { useState } from 'react';
import { Edit2, Check } from 'lucide-react';

interface EditRuleInfoPanelProps {
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  version?: number;
  runtimeReady?: boolean;
  runtimeIssues?: string[];
  assignedPolicies?: number;
  group?: string;
  severity?: string;
}

export function EditRuleInfoPanel({
  createdAt,
  createdBy,
  updatedAt,
  version,
  runtimeReady,
  runtimeIssues = [],
  assignedPolicies = 0,
  group = 'custom',
  severity = 'medium',
}: EditRuleInfoPanelProps) {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notes, setNotes] = useState('Core security rule definition for traffic inspection.');

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="bg-card border border-border p-4 flex flex-col font-sans text-xs text-foreground">
      <div className="pb-2 border-b border-border">
        <div className="text-sm font-semibold text-foreground">Rule Information</div>
      </div>

      <div className="space-y-2 mt-3">
        {/* Created At */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Created At</span>
          <div className="text-foreground flex items-center gap-1.5">
            <span>{formatDate(createdAt)}</span>
            {createdBy && <span className="text-muted-foreground text-[10px]">by {createdBy}</span>}
          </div>
        </div>

        {/* Last Modified */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Last Modified</span>
          <div className="text-foreground flex items-center gap-1.5">
            <span>{formatDate(updatedAt)}</span>
          </div>
        </div>

        {/* Runtime Ready */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Runtime Status</span>
          <div className="flex items-center gap-2">
            {runtimeReady ? (
              <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 inline-block rounded-full" /> Ready
              </span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-[11px] font-semibold">
                <span className="w-1.5 h-1.5 bg-amber-500 dark:bg-amber-400 inline-block rounded-full" /> Not Ready
              </span>
            )}
          </div>
        </div>

        {/* Version */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Version</span>
          <span className="text-cyan-600 dark:text-cyan-400 font-bold">v{version || 1}</span>
        </div>

        {/* Assigned Policies */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Assigned Policies</span>
          <span className="text-foreground font-semibold">{assignedPolicies}</span>
        </div>

        {/* Tags */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Tags</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-400 text-[10px] font-medium rounded-xs">
              {group}
            </span>
            <span className="px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 text-[10px] font-medium rounded-xs">
              {severity}
            </span>
          </div>
        </div>

        {/* Runtime Issues if any */}
        {runtimeIssues && runtimeIssues.length > 0 && (
          <div className="py-1 border-b border-border/50 text-[10px] text-amber-600 dark:text-amber-400 space-y-0.5">
            <span className="font-semibold block">Runtime Issues:</span>
            <ul className="list-disc pl-4 space-y-0.5">
              {runtimeIssues.map((issue, idx) => (
                <li key={idx}>{issue}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Notes */}
        <div className="pt-1">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span>Notes</span>
            <button
              type="button"
              onClick={() => setIsEditingNotes(!isEditingNotes)}
              className="p-1 text-muted-foreground hover:text-foreground cursor-pointer rounded-xs transition-colors"
            >
              {isEditingNotes ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Edit2 className="w-3 h-3 text-muted-foreground" />}
            </button>
          </div>
          {isEditingNotes ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-background border border-input p-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded-xs font-mono text-xs"
            />
          ) : (
            <p className="text-[11px] text-muted-foreground font-sans italic">
              {notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
