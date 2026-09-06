import React from 'react';
import { Globe } from 'lucide-react';

interface ScopeSectionProps {
  target: string;
  setTarget: (val: string) => void;
}

export function ScopeSection({
  target,
  setTarget,
}: ScopeSectionProps) {
  return (
    <section className="bg-card border border-border p-5 space-y-4 shadow-xs rounded-sm font-sans">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          2. Target Scope (Host / Domain)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Define domain boundary where this policy applies. Path and endpoint filtering are handled directly within individual security rules.
        </p>
      </div>

      <div className="text-xs">
        {/* Host Scope */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <span>Host Target</span>
            <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            required
            placeholder="* (All Domains) or specific host (e.g. api.yourdomain.com)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full bg-muted border border-input px-3 py-2 text-foreground text-xs font-mono rounded-sm focus:outline-none focus:border-primary transition-colors"
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Use <code className="text-primary">*</code> to protect all incoming hosts or specify a strict FQDN (e.g. <code className="text-primary">api.example.com</code>).
          </p>
        </div>
      </div>
    </section>
  );
}

export default ScopeSection;

