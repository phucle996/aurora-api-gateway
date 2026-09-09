import React from 'react';
import type { AuthProviderItem } from '../../../../../lib/api';

export interface AuthProvidersSectionProps {
  providers: AuthProviderItem[];
  savingProviderId: string | null;
  onToggleProvider: (provider: AuthProviderItem) => void;
  onOpenSetup: (provider: AuthProviderItem) => void;
}

export function AuthProvidersSection({
  providers,
  savingProviderId,
  onToggleProvider,
  onOpenSetup,
}: AuthProvidersSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-foreground">
          Authentication Providers (Select & Configure)
        </label>
        <span className="text-[11px] text-muted-foreground">
          Multiple providers can be active simultaneously
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {providers.map((method) => (
          <div
            key={method.id}
            className={`p-3.5 border rounded-lg transition-all flex flex-col justify-between space-y-2.5 ${
              method.enabled
                ? 'border-primary/40 bg-primary/5 shadow-xs'
                : 'border-border bg-background'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <label className="flex items-start gap-2.5 cursor-pointer flex-1">
                <input
                  type="checkbox"
                  checked={method.enabled}
                  disabled={savingProviderId === method.id}
                  onChange={() => onToggleProvider(method)}
                  className="mt-0.5 h-4 w-4 rounded border-input text-primary focus:ring-ring cursor-pointer"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground text-xs">
                      {method.name}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                        method.enabled
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {method.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    {method.description}
                  </p>
                </div>
              </label>

              {method.id !== 'local' && (
                <button
                  type="button"
                  onClick={() => onOpenSetup(method)}
                  className="px-2.5 py-1 rounded bg-muted hover:bg-muted/80 text-foreground border border-border text-[11px] font-medium transition-colors cursor-pointer shrink-0"
                >
                  Setup
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
