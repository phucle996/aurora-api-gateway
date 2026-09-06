import React, { useState } from 'react';
import type { AccessRuleDocument } from '../../../lib/api/access';

interface ScopeSectionProps {
  form: AccessRuleDocument;
  setForm: React.Dispatch<React.SetStateAction<AccessRuleDocument>>;
  hosts?: string[];
}

export function ScopeSection({ form, setForm, hosts = [] }: ScopeSectionProps) {
  const [customHost, setCustomHost] = useState(
    form.host !== '*' && !hosts.includes(form.host) ? form.host : ''
  );
  const [isCustom, setIsCustom] = useState(
    form.host !== '*' && !hosts.includes(form.host)
  );

  const scheduleOptions = [
    { value: 'always', label: 'Always' },
    { value: 'business_hours', label: 'Mon–Fri 09:00–18:00 UTC' },
    { value: 'weekend', label: 'Saturday & Sunday UTC' },
    { value: 'night', label: '22:00–06:00 UTC' },
  ];

  const methodOptions = [
    { value: '*', label: 'All Methods' },
    { value: 'GET', label: 'GET' },
    { value: 'POST', label: 'POST' },
    { value: 'PUT', label: 'PUT' },
    { value: 'PATCH', label: 'PATCH' },
    { value: 'DELETE', label: 'DELETE' },
    { value: 'HEAD', label: 'HEAD' },
    { value: 'OPTIONS', label: 'OPTIONS' },
  ];

  return (
    <section className="bg-card border border-border p-5 space-y-4 shadow-xs rounded-sm font-sans text-xs">
      <div>
        <h2 className="text-sm font-semibold text-foreground">
          3. Scope (Optional)
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Define where this rule will be applied across protected hosts and paths.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
        {/* Target (Domain) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-foreground font-medium">
              Target Host
            </label>
            {hosts.length > 0 && (
              <span className="text-[10px] text-primary font-mono">
                {hosts.length} active {hosts.length === 1 ? 'host' : 'hosts'}
              </span>
            )}
          </div>

          <div className="relative">
            <select
              value={isCustom ? 'custom' : form.host}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  setIsCustom(true);
                  setForm((prev) => ({ ...prev, host: customHost || 'example.com' }));
                } else {
                  setIsCustom(false);
                  setForm((prev) => ({ ...prev, host: val }));
                }
              }}
              className="w-full bg-background border border-input px-3 py-2 text-foreground rounded-sm focus:outline-none focus:border-primary transition-colors cursor-pointer appearance-none pr-8 font-mono text-xs"
            >
              <option value="*">All Domains (*)</option>
              {hosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
              <option value="custom">-- Custom Host / Domain --</option>
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-muted-foreground">
              ▼
            </div>
          </div>

          {isCustom && (
            <input
              type="text"
              placeholder="e.g. api.yourdomain.com"
              value={customHost}
              onChange={(e) => {
                const val = e.target.value.trim().toLowerCase();
                setCustomHost(val);
                setForm((prev) => ({ ...prev, host: val || '*' }));
              }}
              className="w-full mt-1.5 bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs rounded-sm focus:outline-none focus:border-primary transition-colors"
            />
          )}
        </div>

        {/* Path (URL Path) */}
        <div className="space-y-1.5">
          <label className="block text-foreground font-medium">
            Path (URL Path)
          </label>
          <input
            type="text"
            placeholder="e.g. /admin (optional)"
            value={form.path_prefix === '/' ? '' : form.path_prefix}
            onChange={(e) => {
              const val = e.target.value.trim();
              setForm((prev) => ({
                ...prev,
                path_prefix: val ? (val.startsWith('/') ? val : '/' + val) : '/',
              }));
            }}
            className="w-full bg-background border border-input px-3 py-2 text-foreground font-mono text-xs rounded-sm focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {/* HTTP Method */}
        <div className="space-y-1.5">
          <label className="block text-foreground font-medium">
            HTTP Method
          </label>
          <div className="relative">
            <select
              value={form.method}
              onChange={(e) => setForm((prev) => ({ ...prev, method: e.target.value }))}
              className="w-full bg-background border border-input px-3 py-2 text-foreground rounded-sm focus:outline-none focus:border-primary transition-colors cursor-pointer appearance-none pr-8 font-mono text-xs"
            >
              {methodOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-muted-foreground">
              ▼
            </div>
          </div>
        </div>

        {/* Time Window (Schedule) */}
        <div className="space-y-1.5">
          <label className="block text-foreground font-medium">
            Time Window
          </label>
          <div className="relative">
            <select
              value={form.schedule}
              onChange={(e) => setForm((prev) => ({ ...prev, schedule: e.target.value }))}
              className="w-full bg-background border border-input px-3 py-2 text-foreground rounded-sm focus:outline-none focus:border-primary transition-colors cursor-pointer appearance-none pr-8 text-xs"
            >
              {scheduleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 flex items-center pr-2.5 pointer-events-none text-muted-foreground">
              ▼
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
