import React, { useState } from 'react';
import {
  X,
  Pencil,
  Shield,
  Layers,
  Trash2,
  Plus,
  Lock,
  ExternalLink,
  Server,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Cpu,
  Radio,
} from 'lucide-react';
import type { DomainItem } from '../types';
import { getTagStyle, renderTlsBadge } from './DomainsTable';

interface DomainDrawerProps {
  domain: DomainItem | null;
  onClose: () => void;
  onEdit: (domain: DomainItem) => void;
  onDelete: (domain: DomainItem) => void;
  onAddTag: (domainId: string, tag: string) => void;
  onUpdateDomain: (updated: DomainItem) => void;
}

type TabType = 'Overview' | 'TLS / Security' | 'Upstream' | 'Bindings';

export function DomainDrawer({
  domain,
  onClose,
  onEdit,
  onDelete,
  onAddTag,
  onUpdateDomain,
}: DomainDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabType>('Overview');
  const [newTagInput, setNewTagInput] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);

  if (!domain) return null;

  const handleAddTagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTagInput.trim()) {
      onAddTag(domain.id, newTagInput.trim().toLowerCase());
      setNewTagInput('');
      setIsAddingTag(false);
    }
  };

  const tabs: TabType[] = ['Overview', 'TLS / Security', 'Upstream', 'Bindings'];

  return (
    <div className="w-full lg:w-[420px] xl:w-[460px] shrink-0 bg-card border-l border-border flex flex-col h-full shadow-lg animate-in slide-in-from-right-4 duration-300 font-sans z-10">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-border flex items-center justify-between bg-card sticky top-0 z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="font-bold text-base text-foreground truncate tracking-tight">
            {domain.domain}
          </h2>
          {domain.status === 'Active' ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 border border-slate-200 dark:border-slate-700/50">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
              Inactive
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          title="Close details"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="relative flex border-b border-border bg-muted/30 text-xs font-medium select-none px-2">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-center transition-colors duration-150 cursor-pointer ${
              activeTab === tab
                ? 'text-blue-600 dark:text-blue-400 font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}

        {/* Sliding Indicator */}
        <div
          className="absolute bottom-0 h-[2px] w-[23%] bg-blue-600 dark:bg-blue-400 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
          style={{
            left: `${tabs.indexOf(activeTab) * 25 + 1}%`,
          }}
        />
      </div>

      {/* Tab Content Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6 text-xs">
        {/* TAB 1: OVERVIEW */}
        {activeTab === 'Overview' && (
          <div className="space-y-6 animate-in fade-in-50 duration-200">
            {/* Domain Information */}
            <div className="bg-card border border-border/70 rounded-lg p-4 shadow-2xs">
              <div className="flex items-center justify-between mb-3.5">
                <h3 className="font-semibold text-[13px] text-foreground">
                  Domain Information
                </h3>
                <button
                  type="button"
                  onClick={() => onEdit(domain)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-border hover:bg-muted text-foreground transition-colors cursor-pointer shadow-xs"
                >
                  <Pencil className="w-3 h-3 text-muted-foreground" />
                  Edit
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Domain</span>
                  <span className="font-semibold text-foreground">{domain.domain}</span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Root Domain</span>
                  <span className="font-medium text-foreground">{domain.rootDomain}</span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Status</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    {domain.status}
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Created At</span>
                  <span className="text-foreground">
                    {domain.createdAt}{' '}
                    <span className="text-muted-foreground">by {domain.createdBy}</span>
                  </span>
                </div>

                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Last Modified</span>
                  <span className="text-foreground">
                    {domain.updatedAt}{' '}
                    <span className="text-muted-foreground">by {domain.createdBy}</span>
                  </span>
                </div>

                <div className="flex flex-col gap-1 py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Description</span>
                  <span className="text-foreground font-normal">
                    {domain.description || 'No description provided.'}
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-muted-foreground">Tags</span>
                  <div className="flex flex-wrap gap-1.5 items-center justify-end">
                    {domain.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium border ${getTagStyle(
                          tag
                        )}`}
                      >
                        {tag}
                      </span>
                    ))}

                    {isAddingTag ? (
                      <form onSubmit={handleAddTagSubmit} className="inline-flex items-center gap-1">
                        <input
                          type="text"
                          autoFocus
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          placeholder="tag..."
                          className="w-16 px-1.5 py-0.5 text-[10px] border border-primary rounded bg-background focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="text-[10px] bg-primary text-primary-foreground px-1 py-0.5 rounded cursor-pointer"
                        >
                          OK
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsAddingTag(false)}
                          className="text-[10px] text-muted-foreground hover:text-foreground px-1 cursor-pointer"
                        >
                          ✕
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsAddingTag(true)}
                        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-medium border border-dashed border-border hover:border-primary text-muted-foreground hover:text-primary transition-colors cursor-pointer"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        Add tag
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <h3 className="font-semibold text-[13px] text-foreground mb-3">
                Quick Actions
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onEdit(domain)}
                  className="flex items-center justify-center gap-2 py-2 px-3 border border-border rounded-lg bg-card hover:bg-muted text-foreground transition-all duration-150 cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                >
                  <Pencil className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="font-medium text-xs">Edit Domain</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('TLS / Security')}
                  className="flex items-center justify-center gap-2 py-2 px-3 border border-border rounded-lg bg-card hover:bg-muted text-foreground transition-all duration-150 cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                >
                  <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-medium text-xs">Manage TLS</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    // Navigate or inform about rules
                    window.location.href = `/rules?domain=${encodeURIComponent(domain.domain)}`;
                  }}
                  className="flex items-center justify-center gap-2 py-2 px-3 border border-border rounded-lg bg-card hover:bg-muted text-foreground transition-all duration-150 cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-medium text-xs">View in Rules</span>
                </button>

                <button
                  type="button"
                  onClick={() => onDelete(domain)}
                  className="flex items-center justify-center gap-2 py-2 px-3 border border-red-200 dark:border-red-900/50 rounded-lg bg-red-50/40 dark:bg-red-950/20 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all duration-150 cursor-pointer shadow-2xs hover:shadow-xs active:scale-98"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="font-medium text-xs">Delete Domain</span>
                </button>
              </div>
            </div>

            {/* Statistics */}
            <div>
              <h3 className="font-semibold text-[13px] text-foreground mb-3">
                Statistics
              </h3>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-card border border-border rounded-lg p-2.5 text-center shadow-2xs hover:border-blue-400/50 transition-colors">
                  <div className="text-xl font-bold text-foreground">
                    {domain.rulesCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    Rules
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-2.5 text-center shadow-2xs hover:border-blue-400/50 transition-colors">
                  <div className="text-xl font-bold text-foreground">
                    {domain.policiesCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    Policies
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-2.5 text-center shadow-2xs hover:border-blue-400/50 transition-colors">
                  <div className="text-xl font-bold text-foreground">
                    {domain.ipRulesCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    IP Rules
                  </div>
                </div>

                <div className="bg-card border border-border rounded-lg p-2.5 text-center shadow-2xs hover:border-blue-400/50 transition-colors">
                  <div className="text-xl font-bold text-foreground">
                    {domain.rateLimitsCount}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-medium mt-0.5">
                    Rate Limits
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-[13px] text-foreground">
                  Recent Activity
                </h3>
                <button
                  type="button"
                  onClick={() => alert(`Showing all audit log history for ${domain.domain}`)}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 transition-colors cursor-pointer"
                >
                  View All
                </button>
              </div>

              <div className="space-y-3 relative pl-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-[2px] before:bg-border">
                {domain.recentActivities && domain.recentActivities.length > 0 ? (
                  domain.recentActivities.map((act) => {
                    const dotColor =
                      act.color === 'emerald'
                        ? 'bg-emerald-500'
                        : act.color === 'blue'
                        ? 'bg-blue-500'
                        : act.color === 'purple'
                        ? 'bg-purple-500'
                        : 'bg-slate-400';

                    return (
                      <div key={act.id} className="relative group">
                        <span
                          className={`absolute -left-[17px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-card ${dotColor}`}
                        />
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-foreground text-xs">
                            {act.title}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {act.timestamp}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {act.description}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-muted-foreground">No recent activity recorded.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: TLS / SECURITY */}
        {activeTab === 'TLS / Security' && (
          <div className="space-y-5 animate-in fade-in-50 duration-200">
            <div className="bg-card border border-border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground text-[13px]">
                  TLS Certificate
                </span>
                {renderTlsBadge(domain.tlsType)}
              </div>

              <div className="space-y-2.5 border-t border-border/40 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Certificate Status</span>
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Valid & Active
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Expires On</span>
                  <span className="text-foreground font-medium">
                    {domain.tlsExpiry || '2026-08-30'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Minimum Protocol</span>
                  <span className="font-mono px-2 py-0.5 bg-muted rounded text-[11px]">
                    {domain.minTlsVersion || 'TLSv1.3'}
                  </span>
                </div>
              </div>
            </div>

            {/* Security Switches */}
            <div className="space-y-3 bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground text-xs">
                Transport Layer Security Settings
              </h4>

              <div className="flex items-center justify-between py-1">
                <div>
                  <div className="font-medium text-foreground">HSTS Preload</div>
                  <div className="text-[11px] text-muted-foreground">
                    Strict-Transport-Security header (max-age=31536000)
                  </div>
                </div>
                <input
                  type="checkbox"
                  defaultChecked={domain.hstsEnabled ?? true}
                  className="rounded accent-primary w-4 h-4 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between py-1 border-t border-border/40">
                <div>
                  <div className="font-medium text-foreground">Auto-Renewal</div>
                  <div className="text-[11px] text-muted-foreground">
                    Renew certificate 30 days before expiration
                  </div>
                </div>
                <input
                  type="checkbox"
                  defaultChecked={domain.tlsAutoRenew ?? true}
                  className="rounded accent-primary w-4 h-4 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between py-1 border-t border-border/40">
                <div>
                  <div className="font-medium text-foreground">OCSP Stapling</div>
                  <div className="text-[11px] text-muted-foreground">
                    Cache certificate revocation status at edge
                  </div>
                </div>
                <input
                  type="checkbox"
                  defaultChecked={domain.ocspStapling ?? true}
                  className="rounded accent-primary w-4 h-4 cursor-pointer"
                />
              </div>

              {domain.tlsType === 'mTLS' && (
                <div className="pt-2 border-t border-border/40">
                  <div className="font-medium text-purple-600 dark:text-purple-400 mb-1">
                    mTLS Client CA Authority
                  </div>
                  <p className="font-mono text-[11px] bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 p-2 rounded border border-purple-200 dark:border-purple-800/40">
                    {domain.clientCaSubject || 'CN=Aurora Root CA, O=Aurora Cloud Inc'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: UPSTREAM */}
        {activeTab === 'Upstream' && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-foreground text-[13px]">
                  Target Backend
                </span>
                <span className="font-mono text-[11px] bg-muted px-2 py-0.5 rounded border border-border">
                  {domain.upstream}
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Load Balance Algorithm</span>
                  <span className="font-medium text-foreground capitalize">
                    {domain.upstreamAlgorithm || 'Round Robin'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Health Check Path</span>
                  <span className="font-mono text-foreground">
                    {domain.healthCheckPath || '/healthz'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-muted-foreground">Connection Timeout</span>
                  <span className="text-foreground">5000ms</span>
                </div>
              </div>
            </div>

            {/* Server instances */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h4 className="font-semibold text-foreground text-xs mb-2">
                Upstream Pool Targets
              </h4>
              <div className="space-y-2">
                {(
                  domain.upstreamServers || [
                    {
                      url: domain.upstream,
                      weight: 1,
                      maxFails: 3,
                      failTimeout: '10s',
                      healthy: domain.status === 'Active',
                    },
                  ]
                ).map((srv, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded bg-muted/40 border border-border text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          srv.healthy ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                      />
                      <span className="font-mono font-medium">{srv.url}</span>
                    </div>
                    <div className="flex items-center gap-3 text-muted-foreground text-[11px]">
                      <span>Weight: {srv.weight}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          srv.healthy
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                        }`}
                      >
                        {srv.healthy ? 'Healthy' : 'Unhealthy'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: BINDINGS */}
        {activeTab === 'Bindings' && (
          <div className="space-y-4 animate-in fade-in-50 duration-200">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-foreground text-[13px]">
                  NGINX Cluster Edge Bindings
                </span>
                <span className="text-xs text-muted-foreground">
                  {domain.nodeBindings?.length || 2} nodes attached
                </span>
              </div>

              <div className="space-y-2.5">
                {(
                  domain.nodeBindings || [
                    {
                      nodeId: 'node-sg-01',
                      nodeName: 'SG Edge Controller 01',
                      ip: '10.0.1.1',
                      ports: [80, 443],
                      status: 'Synced',
                      lastSynced: '2025-08-26 10:14',
                    },
                    {
                      nodeId: 'node-sg-02',
                      nodeName: 'SG Edge Controller 02',
                      ip: '10.0.1.2',
                      ports: [80, 443],
                      status: 'Synced',
                      lastSynced: '2025-08-26 10:14',
                    },
                  ]
                ).map((b) => (
                  <div
                    key={b.nodeId}
                    className="p-2.5 rounded bg-muted/30 border border-border/70 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                        <Server className="w-3.5 h-3.5 text-blue-500" />
                        {b.nodeName}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                        {b.ip} • Ports: {b.ports.join(', ')}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40">
                      <CheckCircle2 className="w-3 h-3" />
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
