import React, { useState, useEffect } from 'react';
import { X, Route, Layers, ArrowRightLeft, Zap, Sparkles } from 'lucide-react';
import { routesApi } from '../../../lib/api/routes';
import { upstreamsApi } from '../../../lib/api/upstreams';
import type { RouteItem, RouteFormState } from '../types';
import { DEFAULT_ROUTE_FORM } from '../types';

interface RouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingRoute: RouteItem | null;
}

export function RouteModal({
  isOpen,
  onClose,
  onSuccess,
  editingRoute,
}: RouteModalProps) {
  const [formData, setFormData] = useState<RouteFormState>(DEFAULT_ROUTE_FORM);
  const [upstreams, setUpstreams] = useState<string[]>([]);
  const [loadingUpstreams, setLoadingUpstreams] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);

    // Fetch live upstreams for selection
    setLoadingUpstreams(true);
    upstreamsApi
      .list({ limit: 100 })
      .then((res) => {
        const names = (res.items || []).map((u) => u.name);
        setUpstreams(names);
        if (!editingRoute && names.length > 0 && !formData.upstream_name) {
          setFormData((prev) => ({ ...prev, upstream_name: names[0] }));
        }
      })
      .catch((err) => console.error('Failed to load upstreams:', err))
      .finally(() => setLoadingUpstreams(false));

    if (editingRoute) {
      setFormData({
        name: editingRoute.name,
        host: editingRoute.host,
        path: editingRoute.path,
        upstream_name: editingRoute.upstream_name,
        enabled: editingRoute.enabled,
        strip_path: editingRoute.strip_path,
        websocket: editingRoute.websocket,
        priority: editingRoute.priority,
        plugins_json: editingRoute.plugins_json || '{}',
        description: editingRoute.description || '',
      });
      setShowAdvanced(Boolean(editingRoute.plugins_json && editingRoute.plugins_json !== '{}'));
    } else {
      setFormData(DEFAULT_ROUTE_FORM);
      setShowAdvanced(false);
    }
  }, [isOpen, editingRoute]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const name = formData.name.trim();
    const host = formData.host.trim().toLowerCase();
    const path = formData.path.trim();
    const upstream = formData.upstream_name.trim();

    if (!name) {
      setError('Route Name is required.');
      return;
    }
    if (!host) {
      setError('Host / Domain is required.');
      return;
    }
    if (!path || !path.startsWith('/')) {
      setError('Path must start with "/" (e.g. / or /api/v1).');
      return;
    }
    if (!upstream) {
      setError('Target Upstream is required.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingRoute) {
        await routesApi.update(editingRoute.id, {
          name,
          host,
          path,
          upstream_name: upstream,
          enabled: formData.enabled,
          strip_path: formData.strip_path,
          websocket: formData.websocket,
          priority: Number(formData.priority) || 0,
          plugins_json: formData.plugins_json || '{}',
          description: formData.description,
        });
      } else {
        await routesApi.create({
          name,
          host,
          path,
          upstream_name: upstream,
          enabled: formData.enabled,
          strip_path: formData.strip_path,
          websocket: formData.websocket,
          priority: Number(formData.priority) || 0,
          plugins_json: formData.plugins_json || '{}',
          description: formData.description,
        });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save route. Please check inputs.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden font-sans">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/70 bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Route className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {editingRoute ? 'Edit Route' : 'Create New Route'}
              </h2>
              <p className="text-xs text-muted-foreground">
                Configure HTTP/HTTPS endpoint path routing to target upstream pool.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {error && (
            <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-lg flex items-center gap-2">
              <span className="font-semibold">Error:</span> {error}
            </div>
          )}

          {/* Route Name */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Route Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Auth Service API"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
            />
          </div>

          {/* Host & Path Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Host / Domain <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. api.aurora.local or *"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Path Prefix <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. / or /api/v1/auth"
                value={formData.path}
                onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
              />
            </div>
          </div>

          {/* Upstream Target & Priority Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Target Upstream <span className="text-destructive">*</span>
              </label>
              <div className="relative">
                <select
                  required
                  value={formData.upstream_name}
                  onChange={(e) => setFormData({ ...formData, upstream_name: e.target.value })}
                  className="w-full px-3 py-2 text-sm bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground appearance-none cursor-pointer"
                >
                  <option value="" disabled>
                    {loadingUpstreams ? 'Loading upstreams...' : 'Select an upstream'}
                  </option>
                  {upstreams.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-2.5 pointer-events-none text-muted-foreground">
                  <Layers className="w-4 h-4" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Priority
              </label>
              <input
                type="number"
                min="0"
                max="1000"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 text-sm font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
              />
            </div>
          </div>

          {/* Feature Switches */}
          <div className="p-3.5 bg-muted/30 border border-border/60 rounded-xl space-y-3">
            <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Route Capabilities</span>
            </div>

            {/* Strip Path */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-400">
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-medium text-foreground block">
                    Strip Path Prefix
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    Removes prefix before forwarding request to backend upstream
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={formData.strip_path}
                onChange={(e) => setFormData({ ...formData, strip_path: e.target.checked })}
                className="w-4 h-4 text-primary rounded-sm border-border focus:ring-primary cursor-pointer"
              />
            </label>

            {/* WebSocket */}
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-violet-500/10 text-violet-400">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div>
                  <span className="text-xs font-medium text-foreground block">
                    WebSocket Upgrade
                  </span>
                  <span className="text-[11px] text-muted-foreground block">
                    Enables HTTP/1.1 Upgrade & Connection forwarding for live streaming
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={formData.websocket}
                onChange={(e) => setFormData({ ...formData, websocket: e.target.checked })}
                className="w-4 h-4 text-primary rounded-sm border-border focus:ring-primary cursor-pointer"
              />
            </label>

            {/* Active Switch */}
            <label className="flex items-center justify-between cursor-pointer group pt-1 border-t border-border/40">
              <div>
                <span className="text-xs font-medium text-foreground block">
                  Serving Status
                </span>
                <span className="text-[11px] text-muted-foreground block">
                  Toggle route activation in compiled NGINX configuration
                </span>
              </div>
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                className="w-4 h-4 text-primary rounded-sm border-border focus:ring-primary cursor-pointer"
              />
            </label>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">
              Description (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. Production microservice gateway route"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-foreground"
            />
          </div>

          {/* Advanced Plugins JSON Collapsible */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-primary hover:underline flex items-center gap-1 font-medium"
            >
              {showAdvanced ? 'Hide Advanced Plugins JSON' : 'Show Advanced Plugins JSON (URI Rewrite, Headers)'}
            </button>
            {showAdvanced && (
              <div className="mt-2">
                <textarea
                  rows={4}
                  value={formData.plugins_json}
                  onChange={(e) => setFormData({ ...formData, plugins_json: e.target.value })}
                  placeholder='{"uri-rewrite": {"rules": []}}'
                  className="w-full px-3 py-2 text-xs font-mono bg-background border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
                />
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border/70">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {submitting ? 'Saving...' : editingRoute ? 'Update Route' : 'Create Route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
