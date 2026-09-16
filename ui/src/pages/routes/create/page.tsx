import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Route,
  Server,
  Layers,
  ArrowRightLeft,
  Zap,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Globe,
  Sliders,
  Code,
  Check,
  HelpCircle,
  ArrowRight,
  ShieldAlert,
} from 'lucide-react';
import { routesApi } from '../../../lib/api/routes';
import { upstreamsApi } from '../../../lib/api/upstreams';
import { DEFAULT_ROUTE_FORM, type RouteFormState } from '../types';

export default function CreateRoutePage() {
  const navigate = useNavigate();

  // Form State
  const [formData, setFormData] = useState<RouteFormState>(DEFAULT_ROUTE_FORM);
  const [upstreams, setUpstreams] = useState<string[]>([]);
  const [loadingUpstreams, setLoadingUpstreams] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Advanced Plugins / JSON state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Load available upstreams
  useEffect(() => {
    setLoadingUpstreams(true);
    upstreamsApi
      .list({ limit: 100 })
      .then((res) => {
        const names = (res.items || []).map((u) => u.name);
        setUpstreams(names);
        if (names.length > 0 && !formData.upstream_name) {
          setFormData((prev) => ({ ...prev, upstream_name: names[0] }));
        }
      })
      .catch((err) => {
        console.error('Failed to load upstreams:', err);
      })
      .finally(() => setLoadingUpstreams(false));
  }, []);

  // Validate JSON on the fly if advanced view is open
  const handlePluginsJsonChange = (val: string) => {
    setFormData((prev) => ({ ...prev, plugins_json: val }));
    if (!val.trim() || val.trim() === '{}') {
      setJsonError(null);
      return;
    }
    try {
      JSON.parse(val);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(e.message || 'Invalid JSON syntax');
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(formData.plugins_json || '{}');
      setFormData((prev) => ({ ...prev, plugins_json: JSON.stringify(parsed, null, 2) }));
      setJsonError(null);
    } catch {
      // Keep as-is if invalid
    }
  };

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

    if (formData.plugins_json && formData.plugins_json.trim() !== '') {
      try {
        JSON.parse(formData.plugins_json);
      } catch {
        setError('Plugins JSON is invalid. Please fix JSON syntax or format it properly.');
        return;
      }
    }

    setSubmitting(true);
    try {
      await routesApi.create({
        name,
        host,
        path,
        upstream_name: upstream,
        enabled: formData.enabled,
        strip_path: formData.strip_path,
        websocket: formData.websocket,
        priority: Number(formData.priority) || 10,
        plugins_json: formData.plugins_json.trim() || '{}',
        description: formData.description.trim(),
      });

      // Redirect back to routes list
      navigate('/routes');
    } catch (err: any) {
      setError(err?.message || 'Failed to create route on server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 font-sans">
      {/* 1. Header & Navigation Breadcrumb */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            to="/routes"
            className="flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Routes</span>
          </Link>
          <span>/</span>
          <span className="text-foreground font-medium">Create Route</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
              <Route className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Create New Route
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Define HTTP traffic matching rules, protocol policies, and target upstream destination.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/routes')}
              className="px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border rounded-md transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-md shadow-xs transition-colors cursor-pointer"
            >
              {submitting ? (
                <span>Creating...</span>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Create & Deploy Route</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 bg-destructive/10 border border-destructive/30 rounded-lg flex items-start gap-2.5 text-xs text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1 font-medium">{error}</div>
        </div>
      )}

      {/* 2. Interactive Live Traffic Flow Diagram (Gateway Dataflow Pipeline) */}
      <div className="p-4 bg-card border border-border rounded-lg shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Live Traffic Dataflow Simulation
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {formData.enabled ? (
              <span className="text-emerald-500 font-semibold flex items-center gap-1">
                <span className="status-dot status-dot-healthy" /> ACTIVE ROUTE
              </span>
            ) : (
              <span className="text-muted-foreground flex items-center gap-1">
                <span className="status-dot status-dot-neutral" /> DISABLED
              </span>
            )}
          </span>
        </div>

        <div className="p-3 bg-muted/40 border border-border/80 rounded-md overflow-x-auto">
          <div className="flex items-center gap-2 text-xs font-mono min-w-max">
            {/* Client Ingress */}
            <div className="px-2.5 py-1.5 rounded-sm bg-background border border-border flex items-center gap-1.5 shadow-2xs">
              <Globe className="w-3.5 h-3.5 text-sky-500" />
              <span className="text-foreground font-semibold">Client Request</span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

            {/* Host Match */}
            <div className="px-2.5 py-1.5 rounded-sm bg-background border border-border flex items-center gap-1.5 shadow-2xs">
              <span className="text-[10px] text-muted-foreground uppercase">Host:</span>
              <span className="text-primary font-bold">{formData.host || '*'}</span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

            {/* Path Match */}
            <div className="px-2.5 py-1.5 rounded-sm bg-background border border-border flex items-center gap-1.5 shadow-2xs">
              <span className="text-[10px] text-muted-foreground uppercase">Path:</span>
              <span className="text-primary font-bold">{formData.path || '/'}</span>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

            {/* Protocol Transformations & Policies */}
            <div className="px-2.5 py-1.5 rounded-sm bg-background border border-border flex items-center gap-2 shadow-2xs">
              <span className="text-[10px] text-muted-foreground uppercase">Policies:</span>
              {formData.strip_path && (
                <span className="px-1.5 py-0.5 rounded-xs bg-amber-500/10 text-amber-500 border border-amber-500/20 text-[10px] font-semibold">
                  Strip Prefix
                </span>
              )}
              {formData.websocket && (
                <span className="px-1.5 py-0.5 rounded-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[10px] font-semibold">
                  WebSocket WS
                </span>
              )}
              {!formData.strip_path && !formData.websocket && (
                <span className="text-[11px] text-muted-foreground">Standard Pass-through</span>
              )}
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

            {/* Target Upstream */}
            <div className="px-2.5 py-1.5 rounded-sm bg-primary/10 border border-primary/30 flex items-center gap-1.5 shadow-2xs">
              <Server className="w-3.5 h-3.5 text-primary" />
              <span className="text-primary font-bold">
                {formData.upstream_name || 'Select Upstream...'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Form Sections */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Route Identity */}
        <div className="p-5 bg-card border border-border rounded-lg space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Route className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">1. Route Identity & Basic Info</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Status:</span>
              <button
                type="button"
                onClick={() => setFormData((prev) => ({ ...prev, enabled: !prev.enabled }))}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  formData.enabled ? 'bg-emerald-500' : 'bg-muted'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                    formData.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              <span className="text-xs font-mono font-medium text-foreground">
                {formData.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1">
                Route Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. auth-service-v1"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                A unique human-readable identifier for this routing policy.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Evaluation Priority
              </label>
              <input
                type="number"
                min="0"
                max="1000"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Higher numbers match first (default: 10).
              </p>
            </div>

            <div className="col-span-full">
              <label className="block text-xs font-medium text-foreground mb-1">
                Description <span className="text-muted-foreground font-normal">(Optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Public facing auth endpoint with rate-limiting"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Traffic Ingress & Matching Criteria */}
        <div className="p-5 bg-card border border-border rounded-lg space-y-4 shadow-xs">
          <div className="flex items-center gap-2 pb-3 border-b border-border">
            <Globe className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">2. Traffic Ingress & Matching Rules</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Host / Domain <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. api.example.com, localhost, or *"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Matches the incoming <code className="text-primary font-mono">Host</code> header. Use <code className="text-primary font-mono">*</code> to match all hosts.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Path Prefix <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. / or /api/v1"
                value={formData.path}
                onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                className="w-full px-3 py-1.5 text-xs bg-background border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors font-mono"
              />
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[10px] text-muted-foreground">Quick picks:</span>
                {['/', '/api', '/api/v1', '/auth'].map((quickPath) => (
                  <button
                    key={quickPath}
                    type="button"
                    onClick={() => setFormData({ ...formData, path: quickPath })}
                    className="px-1.5 py-0.5 text-[10px] font-mono bg-muted text-muted-foreground hover:text-foreground rounded-xs border border-border transition-colors cursor-pointer"
                  >
                    {quickPath}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Target Upstream & Forwarding Policies */}
        <div className="p-5 bg-card border border-border rounded-lg space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">3. Target Upstream & Policies</h2>
            </div>
            <Link
              to="/upstreams/create"
              className="text-xs text-primary hover:underline font-medium"
            >
              + Create New Upstream
            </Link>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Target Upstream Destination <span className="text-destructive">*</span>
              </label>
              {loadingUpstreams ? (
                <div className="text-xs text-muted-foreground py-2 font-mono">
                  Loading upstreams...
                </div>
              ) : upstreams.length === 0 ? (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-center justify-between">
                  <span>No upstreams found. You must create an upstream cluster first.</span>
                  <Link
                    to="/upstreams/create"
                    className="px-2 py-1 bg-destructive text-destructive-foreground rounded-xs font-medium text-[11px]"
                  >
                    Create Upstream
                  </Link>
                </div>
              ) : (
                <select
                  value={formData.upstream_name}
                  onChange={(e) => setFormData({ ...formData, upstream_name: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-background border border-input rounded-md text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors font-mono cursor-pointer"
                >
                  {upstreams.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[11px] text-muted-foreground mt-1">
                Requests matching this route will be load-balanced to instances registered in this upstream.
              </p>
            </div>

            {/* Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              {/* Strip Path */}
              <div
                onClick={() => setFormData({ ...formData, strip_path: !formData.strip_path })}
                className={`p-3 rounded-lg border transition-all cursor-pointer flex items-start gap-3 select-none ${
                  formData.strip_path
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border bg-muted/20 hover:border-input'
                }`}
              >
                <div
                  className={`mt-0.5 w-4 h-4 rounded-xs border flex items-center justify-center shrink-0 ${
                    formData.strip_path
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-input bg-background'
                  }`}
                >
                  {formData.strip_path && <Check className="w-3 h-3" />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <ArrowRightLeft className="w-3.5 h-3.5 text-amber-500" />
                    <span>Strip Path Prefix</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Removes matched path prefix before proxying to backend (e.g. <code className="font-mono text-primary">/api/v1/users</code> becomes <code className="font-mono text-primary">/users</code>).
                  </p>
                </div>
              </div>

              {/* WebSocket Upgrade */}
              <div
                onClick={() => setFormData({ ...formData, websocket: !formData.websocket })}
                className={`p-3 rounded-lg border transition-all cursor-pointer flex items-start gap-3 select-none ${
                  formData.websocket
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border bg-muted/20 hover:border-input'
                }`}
              >
                <div
                  className={`mt-0.5 w-4 h-4 rounded-xs border flex items-center justify-center shrink-0 ${
                    formData.websocket
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-input bg-background'
                  }`}
                >
                  {formData.websocket && <Check className="w-3 h-3" />}
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-purple-400" />
                    <span>WebSocket Upgrade</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Supports bidirectional WS/WSS protocol switching headers for long-lived socket connections.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 4: Extensions & Advanced JSON Policy */}
        <div className="p-5 bg-card border border-border rounded-lg space-y-4 shadow-xs">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Code className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">4. Plugins & Advanced Policy JSON</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs text-primary hover:underline font-medium cursor-pointer"
            >
              {showAdvanced ? 'Hide Editor' : 'Configure Plugins JSON'}
            </button>
          </div>

          {showAdvanced ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    Custom Route Plugin Configuration (JSON):
                  </span>
                  {jsonError ? (
                    <span className="text-[10px] font-mono text-destructive font-semibold">
                      Invalid JSON syntax
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-emerald-500 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Valid JSON
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleFormatJson}
                  className="px-2 py-0.5 text-[11px] font-mono bg-muted text-muted-foreground hover:text-foreground border border-border rounded-xs transition-colors cursor-pointer"
                >
                  Format JSON
                </button>
              </div>

              <textarea
                rows={8}
                value={formData.plugins_json}
                onChange={(e) => handlePluginsJsonChange(e.target.value)}
                placeholder='{\n  "rate_limit": {\n    "rate": 100,\n    "burst": 20\n  }\n}'
                className="w-full p-3 font-mono text-xs bg-muted/40 border border-input rounded-md text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
              />

              {jsonError && (
                <p className="text-[11px] text-destructive font-mono">{jsonError}</p>
              )}

              <p className="text-[11px] text-muted-foreground">
                Define route-specific plugin overrides or extension configurations in JSON format.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Optional: Route-level plugin policies (Rate Limiting, CORS, custom headers) are currently using defaults. Click "Configure Plugins JSON" above to override.
            </p>
          )}
        </div>

        {/* Form Actions Bottom Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate('/routes')}
            className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted border border-border rounded-md transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-md shadow-xs transition-colors cursor-pointer"
          >
            {submitting ? (
              <span>Deploying Route...</span>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Create & Deploy Route</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
