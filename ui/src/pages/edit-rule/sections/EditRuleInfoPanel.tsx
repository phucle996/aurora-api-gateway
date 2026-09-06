import React, { useState } from 'react';
import { ArrowUpRight, Edit2, Check } from 'lucide-react';

export function EditRuleInfoPanel() {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notes, setNotes] = useState('Core OWASP Top 10 mitigation rule for production ingress.');

  return (
    <div className="bg-card border border-border p-4 flex flex-col font-mono text-xs text-foreground">
      <div className="pb-2 border-b border-border">
        <div className="text-sm font-semibold text-foreground">Rule Information</div>
      </div>

      <div className="space-y-2 mt-3">
        {/* Created At */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Created At</span>
          <div className="text-foreground flex items-center gap-1.5">
            <span>2025-08-20 10:14:32</span>
            <span className="text-muted-foreground text-[10px]">by admin</span>
          </div>
        </div>

        {/* Last Modified */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Last Modified</span>
          <div className="text-foreground flex items-center gap-1.5">
            <span>2025-08-26 15:22:18</span>
            <span className="text-muted-foreground text-[10px]">by admin</span>
          </div>
        </div>

        {/* Last Deployed */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Last Deployed</span>
          <div className="flex items-center gap-2">
            <span className="text-foreground">2025-08-26 15:22:30</span>
            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-[11px] font-semibold">
              <span className="w-1.5 h-1.5 bg-emerald-500 dark:bg-emerald-400 inline-block rounded-full" /> Active
            </span>
          </div>
        </div>

        {/* Version */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Version</span>
          <span className="text-cyan-600 dark:text-cyan-400 font-bold">v3</span>
        </div>

        {/* Hit Count */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Hit Count (24h)</span>
          <div className="flex items-center gap-1.5">
            <span className="text-foreground font-semibold">12,421</span>
            <span className="text-rose-600 dark:text-rose-400 flex items-center text-[10px] font-semibold">
              <ArrowUpRight className="w-3 h-3 inline" /> 18%
            </span>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center justify-between py-1 border-b border-border/50">
          <span className="text-muted-foreground">Tags</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-400 text-[10px] font-medium rounded-xs">
              sql-injection
            </span>
            <span className="px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-500/40 text-amber-700 dark:text-amber-400 text-[10px] font-medium rounded-xs">
              web
            </span>
            <span className="px-1.5 py-0.5 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-500/40 text-rose-700 dark:text-rose-400 text-[10px] font-medium rounded-xs">
              critical
            </span>
          </div>
        </div>

        {/* Notes */}
        <div className="pt-1">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span>Notes</span>
            <button
              type="button"
              onClick={() => setIsEditingNotes(!isEditingNotes)}
              className="p-1 text-muted-foreground hover:text-foreground cursor-pointer rounded-xs transition-colors"
            >
              {isEditingNotes ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Edit2 className="w-3 h-3" />}
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
