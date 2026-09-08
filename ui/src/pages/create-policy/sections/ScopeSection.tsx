import React, { useState, useEffect } from 'react';
import { Globe, Server } from 'lucide-react';
import type { DomainCatalogItem } from '../../../lib/api/domains';

interface ScopeSectionProps {
  target: string;
  setTarget: (val: string) => void;
  domains?: DomainCatalogItem[];
  isLoadingDomains?: boolean;
}

export function ScopeSection({
  target,
  setTarget,
  domains = [],
  isLoadingDomains = false,
}: ScopeSectionProps) {
  const isKnownDomain = target === '*' || domains.some((d) => d.domain === target);
  const [isCustom, setIsCustom] = useState(!isKnownDomain && !!target);
  const [customHost, setCustomHost] = useState(!isKnownDomain ? target : '');

  // Keep state synchronized if target changes externally (e.g. edit mode)
  useEffect(() => {
    const known = target === '*' || domains.some((d) => d.domain === target);
    if (!known && target) {
      setIsCustom(true);
      setCustomHost(target);
    } else if (known) {
      setIsCustom(false);
    }
  }, [target, domains]);

  const handleSelectChange = (val: string) => {
    if (val === 'custom') {
      setIsCustom(true);
      setTarget(customHost.trim() || '');
    } else {
      setIsCustom(false);
      setTarget(val);
    }
  };

  return (
    <section className="bg-card border border-border p-5 space-y-4 shadow-xs rounded-sm font-sans">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            2. Target Scope (Host / Domain)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Define domain boundary where this policy applies. Path and endpoint filtering are handled directly within individual security rules.
          </p>
        </div>
        {domains.length > 0 && (
          <span className="text-[10px] text-primary font-mono bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
            {domains.length} configured {domains.length === 1 ? 'domain' : 'domains'}
          </span>
        )}
      </div>

      <div className="text-xs space-y-3">
        {/* Host Scope */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
            <Globe className="w-3.5 h-3.5 text-slate-400" />
            <span>Host Target</span>
            <span className="text-rose-500">*</span>
          </label>

          <div className="relative">
            <select
              value={isCustom ? 'custom' : target}
              onChange={(e) => handleSelectChange(e.target.value)}
              disabled={isLoadingDomains}
              className="w-full bg-muted border border-input px-3 py-2 text-foreground text-xs font-mono rounded-sm focus:outline-none focus:border-primary transition-colors cursor-pointer appearance-none pr-8"
            >
              <option value="*">All Domains (* - Wildcard)</option>
              {domains.length > 0 && (
                <optgroup label="Registered Domains">
                  {domains.map((d) => (
                    <option key={d.id || d.domain} value={d.domain}>
                      {d.domain} {d.status === 'Active' ? '✓' : `(${d.status})`}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="custom">-- Custom Host / Domain (Type Manually) --</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-muted-foreground text-[10px]">
              ▼
            </div>
          </div>

          {isCustom && (
            <div className="pt-1">
              <input
                type="text"
                required
                placeholder="e.g. api.yourdomain.com"
                value={customHost}
                onChange={(e) => {
                  const val = e.target.value.trim().toLowerCase();
                  setCustomHost(val);
                  setTarget(val || '*');
                }}
                className="w-full bg-background border border-input px-3 py-2 text-foreground text-xs font-mono rounded-sm focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 pt-0.5">
            <span>
              Selected Scope: <code className="text-primary font-mono">{target || '*'}</code>
            </span>
            {target !== '*' && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Server className="w-3 h-3" /> Exact FQDN match
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ScopeSection;

