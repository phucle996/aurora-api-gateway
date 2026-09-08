import React, { useState, useRef, useEffect } from 'react';
import {
  Globe,
  FileCode,
  Tag,
  ArrowUp,
  ArrowDown,
  Layers,
  Sparkles,
  Code,
  Check,
  AlertCircle,
} from 'lucide-react';

export type DimensionType = 'ip' | 'header' | 'path';

export interface HeaderMatchConfig {
  headerName: string;
  operator: 'equals' | 'contains' | 'starts_with' | 'regex' | 'exists';
  headerValue: string;
  caseSensitive: boolean;
}

export interface PathScopeConfig {
  path: string;
  matchType: 'prefix' | 'exact' | 'regex';
}

export interface IpConfig {
  source: 'binary_remote_addr' | 'remote_addr' | 'x_forwarded_for';
  subnetMask: '/32' | '/24' | '/16';
}

export interface RateLimitConfigProps {
  enabledDimensions: DimensionType[];
  setEnabledDimensions: React.Dispatch<React.SetStateAction<DimensionType[]>>;
  dimensionOrder: DimensionType[];
  setDimensionOrder: React.Dispatch<React.SetStateAction<DimensionType[]>>;
  ipConfig: IpConfig;
  setIpConfig: React.Dispatch<React.SetStateAction<IpConfig>>;
  headerConfig: HeaderMatchConfig;
  setHeaderConfig: React.Dispatch<React.SetStateAction<HeaderMatchConfig>>;
  pathConfig: PathScopeConfig;
  setPathConfig: React.Dispatch<React.SetStateAction<PathScopeConfig>>;
  rateLimit: number;
  setRateLimit: (n: number) => void;
  rateUnit: string;
  setRateUnit: (u: string) => void;
  burst: number;
  setBurst: (n: number) => void;
  actionExceeded: string;
  setActionExceeded: (a: string) => void;
  customResponse: boolean;
  setCustomResponse: (v: boolean) => void;
  responseCode: string;
  setResponseCode: (v: string) => void;
  responseBody: string;
  setResponseBody: (v: string) => void;
}

export const HTTP_STATUS_CODES = [
  { code: '429', label: '429 Too Many Requests (Standard Rate Limit)' },
  { code: '403', label: '403 Forbidden (Access Denied)' },
  { code: '400', label: '400 Bad Request' },
  { code: '401', label: '401 Unauthorized' },
  { code: '404', label: '404 Not Found' },
  { code: '405', label: '405 Method Not Allowed' },
  { code: '408', label: '408 Request Timeout' },
  { code: '418', label: "418 I'm a Teapot" },
  { code: '500', label: '500 Internal Server Error' },
  { code: '502', label: '502 Bad Gateway' },
  { code: '503', label: '503 Service Unavailable' },
  { code: '504', label: '504 Gateway Timeout' },
  { code: '444', label: '444 Connection Closed Without Response (NGINX Drop)' },
];

export function RateLimitConfigSection({
  enabledDimensions,
  setEnabledDimensions,
  dimensionOrder,
  setDimensionOrder,
  ipConfig,
  setIpConfig,
  headerConfig,
  setHeaderConfig,
  pathConfig,
  setPathConfig,
  rateLimit,
  setRateLimit,
  rateUnit,
  setRateUnit,
  burst,
  setBurst,
  actionExceeded,
  setActionExceeded,
  customResponse,
  setCustomResponse,
  responseCode,
  setResponseCode,
  responseBody,
  setResponseBody,
}: RateLimitConfigProps) {
  // Active Tab for dynamic tab rendering (defaults to first enabled dimension)
  const [activeTab, setActiveTab] = useState<DimensionType>(
    enabledDimensions[0] || 'ip'
  );

  // Auto-switch tab if the active tab gets unchecked
  useEffect(() => {
    if (!enabledDimensions.includes(activeTab) && enabledDimensions.length > 0) {
      setActiveTab(enabledDimensions[0]);
    }
  }, [enabledDimensions, activeTab]);

  // Dynamic textarea height ref
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(120, textareaRef.current.scrollHeight)}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [responseBody, customResponse]);

  // Prettify JSON helper
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(responseBody);
      setResponseBody(JSON.stringify(parsed, null, 2));
    } catch {
      // ignore if invalid
    }
  };

  // Toggle a dimension on/off
  const toggleDimension = (dim: DimensionType) => {
    if (enabledDimensions.includes(dim)) {
      if (enabledDimensions.length <= 1) return; // Must keep at least one
      const updated = enabledDimensions.filter((d) => d !== dim);
      setEnabledDimensions(updated);
      setDimensionOrder(dimensionOrder.filter((d) => d !== dim));
    } else {
      const updated = [...enabledDimensions, dim];
      setEnabledDimensions(updated);
      setDimensionOrder([...dimensionOrder, dim]);
      setActiveTab(dim);
    }
  };

  // Move dimension priority up / down
  const movePriority = (dim: DimensionType, direction: 'up' | 'down') => {
    const idx = dimensionOrder.indexOf(dim);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= dimensionOrder.length) return;

    const newOrder = [...dimensionOrder];
    const [moved] = newOrder.splice(idx, 1);
    newOrder.splice(targetIdx, 0, moved);
    setDimensionOrder(newOrder);
  };

  const getDimensionMeta = (dim: DimensionType) => {
    switch (dim) {
      case 'ip':
        return {
          id: 'ip',
          label: 'Client IP',
          icon: <Globe className="w-3.5 h-3.5" />,
          desc: 'Track requests by client IP address or subnet',
        };
      case 'header':
        return {
          id: 'header',
          label: 'Header Match',
          icon: <Tag className="w-3.5 h-3.5" />,
          desc: 'Track by request headers (API Key, Token, Auth)',
        };
      case 'path':
        return {
          id: 'path',
          label: 'URL Path',
          icon: <FileCode className="w-3.5 h-3.5" />,
          desc: 'Track requests bounded to specific endpoint paths',
        };
    }
  };

  return (
    <div className="bg-card border border-border p-4 space-y-4 font-sans text-xs shadow-xs rounded-sm">
      <div>
        <div className="text-sm font-semibold text-foreground">
          2. Rate Limit Configuration
        </div>
        <p className="text-muted-foreground text-[11px] mt-0.5 font-sans">
          Combine Client IP, Header match, and Path dimensions with configurable evaluation priority.
        </p>
      </div>

      {/* 2.1 Multi-Dimension Key Combination */}
      <div className="space-y-2">
        <label className="block text-foreground font-semibold text-xs">
          Rate Limit Keys (Multi-Key Combination)
        </label>
        <p className="text-[11px] text-muted-foreground">
          Select which dimensions to evaluate together. You can enable 1, 2, or all 3 keys simultaneously:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          {(['ip', 'header', 'path'] as DimensionType[]).map((dim) => {
            const meta = getDimensionMeta(dim);
            const isChecked = enabledDimensions.includes(dim);
            return (
              <div
                key={dim}
                onClick={() => toggleDimension(dim)}
                className={`p-3 rounded-sm border transition-all cursor-pointer flex flex-col justify-between ${
                  isChecked
                    ? 'bg-primary/10 border-primary text-foreground shadow-xs'
                    : 'bg-background border-border text-muted-foreground hover:border-input'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={isChecked ? 'text-primary' : 'text-muted-foreground'}>
                      {meta.icon}
                    </span>
                    <span className="font-semibold text-xs text-foreground">
                      {meta.label}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {}}
                    className="mt-0.5 h-3.5 w-3.5 accent-primary cursor-pointer"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                  {meta.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2.2 Evaluation Priority / Order */}
      <div className="p-3 bg-muted/40 border border-border rounded-sm space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Layers className="w-3.5 h-3.5 text-primary" />
            <span>Dimension Evaluation Priority (Order)</span>
          </div>
          <span className="text-[10px] text-muted-foreground font-mono">
            Evaluated left to right
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {dimensionOrder.map((dim, idx) => {
            const meta = getDimensionMeta(dim);
            const isFirst = idx === 0;
            const isLast = idx === dimensionOrder.length - 1;

            return (
              <div
                key={dim}
                className="flex items-center gap-1.5 bg-card border border-border px-2.5 py-1 rounded-sm shadow-2xs font-mono text-xs"
              >
                <span className="w-4 h-4 rounded-full bg-primary/10 text-primary font-bold text-[10px] flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>
                <span className="font-medium text-foreground">{meta.label}</span>

                <div className="flex items-center gap-0.5 ml-1 border-l border-border pl-1">
                  <button
                    type="button"
                    disabled={isFirst}
                    onClick={() => movePriority(dim, 'up')}
                    className="p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed rounded"
                    title="Move higher priority"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    disabled={isLast}
                    onClick={() => movePriority(dim, 'down')}
                    className="p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed rounded"
                    title="Move lower priority"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2.3 Dynamic Tabs for Detailed Dimension Settings */}
      <div className="border border-border rounded-sm overflow-hidden">
        {/* Dynamic Tab Headers */}
        <div className="flex border-b border-border bg-muted/40 overflow-x-auto">
          {enabledDimensions.map((dim) => {
            const meta = getDimensionMeta(dim);
            const isActive = activeTab === dim;
            return (
              <button
                key={dim}
                type="button"
                onClick={() => setActiveTab(dim)}
                className={`flex items-center gap-2 px-4 py-2.5 transition-colors cursor-pointer whitespace-nowrap text-xs font-medium ${
                  isActive
                    ? 'text-primary border-b-2 border-primary font-semibold bg-card'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                }`}
              >
                {meta.icon}
                <span>{meta.label} Config</span>
              </button>
            );
          })}
        </div>

        {/* Dynamic Tab Body */}
        <div className="p-4 bg-card">
          {/* Tab 1: Client IP */}
          {activeTab === 'ip' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
                  IP Variable Source
                </label>
                <select
                  value={ipConfig.source}
                  onChange={(e) =>
                    setIpConfig({
                      ...ipConfig,
                      source: e.target.value as IpConfig['source'],
                    })
                  }
                  className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary cursor-pointer rounded-sm"
                >
                  <option value="binary_remote_addr">$binary_remote_addr (Standard IP 4 bytes / IPv6 16 bytes)</option>
                  <option value="remote_addr">$remote_addr (Direct Socket IP)</option>
                  <option value="x_forwarded_for">$http_x_forwarded_for (Behind Reverse Proxy / CDN)</option>
                </select>
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  Memory optimized: uses 10MB zone for ~160,000 unique client IP states.
                </span>
              </div>

              <div>
                <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
                  Subnet Aggregation Mask
                </label>
                <select
                  value={ipConfig.subnetMask}
                  onChange={(e) =>
                    setIpConfig({
                      ...ipConfig,
                      subnetMask: e.target.value as IpConfig['subnetMask'],
                    })
                  }
                  className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary cursor-pointer rounded-sm"
                >
                  <option value="/32">/32 (Per Individual IP address)</option>
                  <option value="/24">/24 (Group entire /24 subnet together)</option>
                  <option value="/16">/16 (Group entire /16 network)</option>
                </select>
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  /24 aggregation prevents botnets rotating single IP octets.
                </span>
              </div>
            </div>
          )}

          {/* Tab 2: Header Match */}
          {activeTab === 'header' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
                    Header Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    value={headerConfig.headerName}
                    onChange={(e) =>
                      setHeaderConfig({ ...headerConfig, headerName: e.target.value })
                    }
                    placeholder="e.g. X-API-Key, Authorization"
                    className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary rounded-sm"
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
                    Operator
                  </label>
                  <select
                    value={headerConfig.operator}
                    onChange={(e) =>
                      setHeaderConfig({
                        ...headerConfig,
                        operator: e.target.value as HeaderMatchConfig['operator'],
                      })
                    }
                    className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary cursor-pointer rounded-sm"
                  >
                    <option value="equals">Exact Match (=)</option>
                    <option value="contains">Contains</option>
                    <option value="starts_with">Starts With</option>
                    <option value="regex">Regex Match (~*)</option>
                    <option value="exists">Header Exists (Any Value)</option>
                  </select>
                </div>

                {headerConfig.operator !== 'exists' && (
                  <div>
                    <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
                      Header Value Pattern
                    </label>
                    <input
                      type="text"
                      value={headerConfig.headerValue}
                      onChange={(e) =>
                        setHeaderConfig({ ...headerConfig, headerValue: e.target.value })
                      }
                      placeholder="e.g. key_live_*, Bearer"
                      className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary rounded-sm"
                    />
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={headerConfig.caseSensitive}
                  onChange={(e) =>
                    setHeaderConfig({ ...headerConfig, caseSensitive: e.target.checked })
                  }
                  className="h-3.5 w-3.5 accent-primary cursor-pointer"
                />
                <span className="text-[11px] text-muted-foreground">
                  Case-sensitive match for header value
                </span>
              </label>
            </div>
          )}

          {/* Tab 3: Path Scope */}
          {activeTab === 'path' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
                  Target URL Path / Endpoint <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  value={pathConfig.path}
                  onChange={(e) =>
                    setPathConfig({ ...pathConfig, path: e.target.value })
                  }
                  placeholder="e.g. /api/login or /auth/*"
                  className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary rounded-sm"
                />
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  Only requests matching this path are metered by the rate limiter.
                </span>
              </div>

              <div>
                <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
                  Path Match Type
                </label>
                <select
                  value={pathConfig.matchType}
                  onChange={(e) =>
                    setPathConfig({
                      ...pathConfig,
                      matchType: e.target.value as PathScopeConfig['matchType'],
                    })
                  }
                  className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary cursor-pointer rounded-sm"
                >
                  <option value="prefix">Prefix Match (/api/login*)</option>
                  <option value="exact">Exact Match (/api/login)</option>
                  <option value="regex">Regular Expression Match (~*)</option>
                </select>
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  Prefix match handles trailing slashes and nested parameters.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2.4 Rate, Burst & Action */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start pt-1">
        {/* Rate Limit */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
            Rate Limit <span className="text-destructive">*</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={rateLimit}
              onChange={(e) => setRateLimit(parseInt(e.target.value) || 1)}
              className="w-20 bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary rounded-sm"
            />
            <span className="text-muted-foreground text-[11px] shrink-0">requests per</span>
            <select
              value={rateUnit}
              onChange={(e) => setRateUnit(e.target.value)}
              className="bg-background border border-input px-2 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer text-xs rounded-sm"
            >
              <option value="1 second">1 second</option>
              <option value="1 minute">1 minute</option>
              <option value="1 hour">1 hour</option>
            </select>
          </div>
        </div>

        {/* Burst */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
            Burst Tolerance (Capacity)
          </label>
          <input
            type="number"
            min={0}
            value={burst}
            onChange={(e) => setBurst(parseInt(e.target.value) || 0)}
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground font-mono text-xs focus:outline-none focus:border-primary rounded-sm"
          />
          <span className="text-muted-foreground text-[10px] mt-0.5 block">
            Maximum tokens allowed in leaky bucket above nominal rate.
          </span>
        </div>

        {/* Action When Exceeded */}
        <div>
          <label className="block text-muted-foreground mb-1 text-[11px] font-medium">
            Action When Exceeded <span className="text-destructive">*</span>
          </label>
          <select
            value={actionExceeded}
            onChange={(e) => setActionExceeded(e.target.value)}
            className="w-full bg-background border border-input px-3 py-1.5 text-foreground focus:outline-none focus:border-primary cursor-pointer text-xs rounded-sm"
          >
            <option value="block_429">🚫 Block Request (Custom Response Code)</option>
            <option value="challenge">🛡 Challenge (Interactive Verification)</option>
            <option value="log_only">📝 Log Only / Monitor</option>
            <option value="drop">⛔ Drop Connection (TCP RST)</option>
          </select>
        </div>
      </div>

      {/* 2.5 Full Response Code & Dynamic Height JSON Response Body */}
      <div className="space-y-3 pt-3 border-t border-border">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={customResponse}
            onChange={(e) => setCustomResponse(e.target.checked)}
            className="mt-0.5 w-4 h-4 bg-background border border-input text-primary focus:ring-0 cursor-pointer accent-primary rounded-xs"
          />
          <div>
            <div className="text-foreground font-semibold text-xs">Return Custom HTTP Response</div>
            <div className="text-muted-foreground text-[11px] font-sans mt-0.5">
              Customize status code and JSON payload sent to throttled clients.
            </div>
          </div>
        </label>

        {customResponse && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pl-6 pt-1">
            {/* Full Response Code Select (5 cols) */}
            <div className="md:col-span-5 space-y-1.5">
              <label className="block text-muted-foreground text-[11px] font-medium">
                HTTP Response Code (Full List)
              </label>
              <select
                value={responseCode}
                onChange={(e) => setResponseCode(e.target.value)}
                className="w-full bg-background border border-input px-3 py-2 text-foreground font-mono text-xs focus:outline-none focus:border-primary cursor-pointer rounded-sm"
              >
                {HTTP_STATUS_CODES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground">
                Code sent in header status line upon rate limit breach.
              </p>
            </div>

            {/* Response Body (JSON) with Auto Dynamic Height (7 cols) */}
            <div className="md:col-span-7 space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-muted-foreground text-[11px] font-medium">
                  Response Body (JSON)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleFormatJson}
                    className="text-[10px] text-primary hover:underline font-medium flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    Format JSON
                  </button>
                  <span className="text-muted-foreground text-[10px] font-mono">
                    {responseBody.length} chars
                  </span>
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={responseBody}
                onChange={(e) => {
                  setResponseBody(e.target.value);
                  adjustTextareaHeight();
                }}
                rows={6}
                placeholder={`{\n  "error": "rate_limited",\n  "status": 429,\n  "message": "Too many requests. Please try again later."\n}`}
                className="w-full bg-background border border-input p-3 text-foreground font-mono text-xs leading-relaxed focus:outline-none focus:border-primary rounded-sm transition-all resize-y min-h-[120px]"
              />
              <p className="text-[10px] text-muted-foreground">
                Content-Type: <code>application/json; charset=utf-8</code> is automatically injected.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

