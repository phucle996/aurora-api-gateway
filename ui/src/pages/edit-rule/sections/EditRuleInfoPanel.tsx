import React, { useState } from 'react';
import { ArrowUpRight, Edit2, Check } from 'lucide-react';

export function EditRuleInfoPanel() {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notes, setNotes] = useState('Core OWASP Top 10 mitigation rule for production ingress.');

  return (
    <div className="bg-[#0B1320] border border-[#152030] p-4 flex flex-col font-mono text-xs">
      <div className="pb-2 border-b border-[#152030]">
        <div className="text-sm font-semibold text-white">Rule Information</div>
      </div>

      <div className="space-y-2 mt-3">
        {/* Created At */}
        <div className="flex items-center justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Created At</span>
          <div className="text-slate-200 flex items-center gap-1.5">
            <span>2025-08-20 10:14:32</span>
            <span className="text-slate-500">by admin</span>
          </div>
        </div>

        {/* Last Modified */}
        <div className="flex items-center justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Last Modified</span>
          <div className="text-slate-200 flex items-center gap-1.5">
            <span>2025-08-26 15:22:18</span>
            <span className="text-slate-500">by admin</span>
          </div>
        </div>

        {/* Last Deployed */}
        <div className="flex items-center justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Last Deployed</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-200">2025-08-26 15:22:30</span>
            <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
              <span className="w-1.5 h-1.5 bg-emerald-400 inline-block" /> Active
            </span>
          </div>
        </div>

        {/* Version */}
        <div className="flex items-center justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Version</span>
          <span className="text-cyan-400 font-bold">v3</span>
        </div>

        {/* Hit Count */}
        <div className="flex items-center justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Hit Count (24h)</span>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-200 font-semibold">12,421</span>
            <span className="text-rose-400 flex items-center text-[10px]">
              <ArrowUpRight className="w-3 h-3 inline" /> 18%
            </span>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-center justify-between py-1 border-b border-[#152030]/50">
          <span className="text-slate-400">Tags</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-1.5 py-0.5 bg-rose-950/60 border border-rose-500/40 text-rose-400 text-[10px]">
              sql-injection
            </span>
            <span className="px-1.5 py-0.5 bg-amber-950/60 border border-amber-500/40 text-amber-400 text-[10px]">
              web
            </span>
            <span className="px-1.5 py-0.5 bg-rose-950/60 border border-rose-500/40 text-rose-400 text-[10px]">
              critical
            </span>
          </div>
        </div>

        {/* Notes */}
        <div className="pt-1">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span>Notes</span>
            <button
              type="button"
              onClick={() => setIsEditingNotes(!isEditingNotes)}
              className="p-1 text-slate-400 hover:text-white cursor-pointer"
            >
              {isEditingNotes ? <Check className="w-3 h-3 text-emerald-400" /> : <Edit2 className="w-3 h-3" />}
            </button>
          </div>
          {isEditingNotes ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-[#0E1726] border border-[#1C293D] p-2 text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          ) : (
            <p className="text-[11px] text-slate-400 font-sans italic">
              {notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
