import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server,
  Plus,
  Search,
  CheckCircle2,
  ShieldCheck,
  Shield,
  Layers,
  Activity,
  ArrowRight,
  ExternalLink,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react';
import type { UpstreamItem, UpstreamType } from './types';
import { INITIAL_UPSTREAMS } from './mockData';

export default function UpstreamsPage() {
  const navigate = useNavigate();

  const [upstreams, setUpstreams] = useState<UpstreamItem[]>(() => {
    try {
      const saved = localStorage.getItem('aurora_waf_upstreams');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_UPSTREAMS;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [deleteTarget, setDeleteTarget] = useState<UpstreamItem | null>(null);

  const saveUpstreams = (updated: UpstreamItem[]) => {
    setUpstreams(updated);
    try {
      localStorage.setItem('aurora_waf_upstreams', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const next = upstreams.filter((u) => u.id !== deleteTarget.id);
    saveUpstreams(next);
    setDeleteTarget(null);
  };

  // Stats calculation
  const totalUpstreams = upstreams.length;
  const totalNodes = upstreams.reduce((acc, u) => acc + u.servers.length, 0);
  const healthyNodes = upstreams.reduce(
    (acc, u) => acc + u.servers.filter((s) => s.healthy).length,
    0
  );
  const sslProtectedCount = upstreams.filter((u) => u.internalSsl.enabled).length;

  const filtered = useMemo(() => {
    return upstreams.filter((u) => {
      if (typeFilter !== 'ALL' && u.type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = u.name.toLowerCase().includes(q);
        const matchDesc = u.description?.toLowerCase().includes(q);
        const matchServers = u.servers.some((s) => s.address.toLowerCase().includes(q));
        const matchFqdn = u.externalFqdn?.toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchServers && !matchFqdn) return false;
      }
      return true;
    });
  }, [upstreams, typeFilter, searchQuery]);

  return (
    <div className="p-4 sm:p-6 w-full min-h-screen space-y-6 font-sans bg-background text-foreground">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="text-xs text-muted-foreground mb-1">
            Origin Architecture <span className="mx-1.5 text-border">/</span>{' '}
            <span className="text-foreground">Backend Upstreams</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Upstreams
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage backend server pools, balancing algorithms, internal mTLS to BE, and active health check probes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/upstreams/create')}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-all duration-150 cursor-pointer shadow-sm active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Add Upstream</span>
        </button>
      </div>

      {/* 2. Stat Cards (60-30-10) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">TOTAL UPSTREAMS</span>
            <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
              <Server className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{totalUpstreams}</div>
          <div className="text-[11px] text-muted-foreground">Configured origin clusters</div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">HEALTHY NODES</span>
            <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {healthyNodes} <span className="text-sm font-normal text-muted-foreground">/ {totalNodes}</span>
          </div>
          <div className="text-[11px] text-primary font-medium">100% backend nodes healthy</div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">INTERNAL SSL / MTLS</span>
            <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
              <ShieldCheck className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">{sslProtectedCount}</div>
          <div className="text-[11px] text-muted-foreground">Upstreams encrypted to BE</div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4 space-y-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">LOAD BALANCERS</span>
            <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center">
              <Layers className="w-3.5 h-3.5" />
            </div>
          </div>
          <div className="text-2xl font-bold text-foreground">
            {upstreams.filter((u) => u.type === 'Load Balancer').length}
          </div>
          <div className="text-[11px] text-muted-foreground">Multi-node cluster pools</div>
        </div>
      </div>

      {/* 3. Search and Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card border border-border p-3 rounded-lg shadow-xs">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search upstream by name, address, or FQDN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-background border border-border pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary rounded-md transition-colors"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-background border border-border text-foreground px-3 py-1.5 text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer font-medium"
          >
            <option value="ALL">All Types</option>
            <option value="Single Server">Single Server</option>
            <option value="Load Balancer">Load Balancer</option>
            <option value="External (FQDN)">External (FQDN)</option>
          </select>
        </div>
      </div>

      {/* 4. Upstreams Table */}
      <div className="border border-border bg-card rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground border-b border-border text-[11px] uppercase tracking-wider font-semibold">
              <tr>
                <th className="p-3.5">Upstream Cluster</th>
                <th className="p-3.5">Architecture</th>
                <th className="p-3.5">Backend Nodes Pool</th>
                <th className="p-3.5">Internal SSL (to BE)</th>
                <th className="p-3.5">Probe Checks</th>
                <th className="p-3.5 text-center">Bound Domains</th>
                <th className="p-3.5 text-right pr-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                  {/* Name & Desc */}
                  <td className="p-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                        <Server className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <div className="font-semibold text-foreground">{item.name}</div>
                        {item.description && (
                          <div className="text-[11px] text-muted-foreground line-clamp-1 max-w-xs">
                            {item.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Architecture */}
                  <td className="p-3.5">
                    <div className="space-y-1">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-muted text-foreground border border-border">
                        {item.type}
                      </span>
                      {item.type === 'Load Balancer' && (
                        <div className="text-[11px] font-mono text-muted-foreground capitalize">
                          alg: {item.algorithm.replace('_', ' ')}
                        </div>
                      )}
                    </div>
                  </td>

                  {/* Backend Nodes Pool */}
                  <td className="p-3.5">
                    <div className="flex flex-wrap gap-1.5 max-w-sm">
                      {item.servers.map((srv) => (
                        <span
                          key={srv.id}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono bg-background border border-border text-foreground"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                          <span>{srv.address}</span>
                          {srv.weight > 1 && (
                            <span className="text-[9px] text-muted-foreground">w:{srv.weight}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Internal SSL to BE */}
                  <td className="p-3.5">
                    {item.internalSsl.enabled ? (
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${item.internalSsl.mTLS
                              ? 'bg-secondary/15 text-secondary border border-secondary/30'
                              : 'bg-primary/15 text-primary border border-primary/30'
                            }`}
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>{item.internalSsl.mTLS ? 'Internal mTLS' : 'HTTPS Verify'}</span>
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-[11px]">Plain HTTP</span>
                    )}
                  </td>

                  {/* Probe Checks */}
                  <td className="p-3.5">
                    <div className="flex flex-wrap gap-1">
                      {item.probes.map((pr) => (
                        <span
                          key={pr.id}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted/60 text-muted-foreground border border-border"
                        >
                          {pr.path} ({pr.type.slice(0, 4)})
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Bound Domains */}
                  <td className="p-3.5 text-center">
                    <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-muted text-foreground">
                      {item.boundDomainsCount} domains
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="p-3.5 text-right pr-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors cursor-pointer"
                        title="Delete Upstream"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                <h3 className="text-sm font-bold text-foreground">Delete Upstream?</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              <p className="text-muted-foreground">
                Are you sure you want to delete upstream cluster{' '}
                <strong className="text-foreground">{deleteTarget.name}</strong>?
              </p>
              {deleteTarget.boundDomainsCount > 0 && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded text-destructive text-[11px]">
                  Warning: There are currently {deleteTarget.boundDomainsCount} domain(s) routing to this upstream. Deleting it will disrupt ingress traffic routing.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t border-border bg-muted/20">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-3.5 py-1.5 text-xs font-semibold bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded"
              >
                Delete Upstream
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
