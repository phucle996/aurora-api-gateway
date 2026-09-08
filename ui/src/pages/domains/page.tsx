import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  RefreshCw,
  Search,
  ChevronDown,
  Globe,
  SlidersHorizontal,
} from 'lucide-react';
import type { DomainItem, DomainStatus, TlsType } from './types';
import { domainsApi } from '../../lib/api';
import { DomainsStats } from './sections/DomainsStats';
import { DomainsTable } from './sections/DomainsTable';
import { DomainDrawer } from './sections/DomainDrawer';
import { DeleteDomainDialog } from './sections/DeleteDomainDialog';

export default function DomainsPage() {
  const navigate = useNavigate();
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [error, setError] = useState('');
  const mutation = useRef(false);
  const request = useRef(0);
  // Selected domain for side drawer
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null);

  // Search and filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [tlsFilter, setTlsFilter] = useState<string>('ALL');
  const [tagFilter, setTagFilter] = useState<string>('ALL');
  const [statFilter, setStatFilter] = useState<string | null>(null);

  // Refresh spin state
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Modals state
  const [deletingDomain, setDeletingDomain] = useState<DomainItem | null>(null);

  const loadDomainsFromApi = useCallback(async () => {
    const sequence = ++request.current;
    try {
      const items: DomainItem[] = [];
      for (let page = 1; ; page++) {
        const res = await domainsApi.list({ limit: 100, page });
        items.push(...res.items);
        if (!res.items.length || items.length >= res.total_filtered) break;
      }
      if (sequence === request.current) { setDomains(items); setError(''); }
    } catch (err) {
      if (sequence === request.current) setError(err instanceof Error ? err.message : 'Unable to load domains');
    }
  }, []);
  useEffect(() => {
    void loadDomainsFromApi();
    const timer = setInterval(() => { if (!mutation.current) void loadDomainsFromApi(); }, 5000);
    return () => { clearInterval(timer); request.current++; };
  }, [loadDomainsFromApi]);

  // Selected domain object
  const selectedDomain = useMemo(() => {
    return domains.find((d) => d.id === selectedDomainId) || null;
  }, [domains, selectedDomainId]);

  // All unique tags for tag filter dropdown
  const allUniqueTags = useMemo(() => {
    const set = new Set<string>();
    domains.forEach((d) => d.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [domains]);

  // Filtered domains
  const filteredDomains = useMemo(() => {
    return domains.filter((item) => {
      // Stat card quick filter
      if (statFilter) {
        if (statFilter === 'status:Active' && item.status !== 'Active') return false;
        if (statFilter === 'status:Inactive' && item.status !== 'Inactive') return false;
        if (statFilter === 'tls:mTLS' && item.tlsType !== 'mTLS') return false;
      }

      // Dropdown Status filter
      if (statusFilter !== 'ALL' && item.status !== statusFilter) {
        return false;
      }

      // Dropdown TLS filter
      if (tlsFilter !== 'ALL' && item.tlsType !== tlsFilter) {
        return false;
      }

      // Dropdown Tag filter
      if (tagFilter !== 'ALL' && !item.tags.includes(tagFilter)) {
        return false;
      }

      // Search query (domain, rootDomain, upstream, tags)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchDomain = item.domain.toLowerCase().includes(q);
        const matchRoot = item.rootDomain.toLowerCase().includes(q);
        const matchUpstream = item.upstream.toLowerCase().includes(q);
        const matchTag = item.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchDomain && !matchRoot && !matchUpstream && !matchTag) {
          return false;
        }
      }

      return true;
    });
  }, [domains, statFilter, statusFilter, tlsFilter, tagFilter, searchQuery]);

  // Handlers
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDomainsFromApi();
    setTimeout(() => {
      setIsRefreshing(false);
    }, 400);
  };

  const handleUpdateDomain = async (updated: DomainItem) => {
    if (mutation.current) return;
    mutation.current = true; request.current++;
    try {
      await domainsApi.update(updated.id, {status: updated.status, tls_type: updated.tlsType,
        min_tls_version: updated.minTlsVersion, hsts_enabled: updated.hstsEnabled,
        ocsp_stapling: updated.ocspStapling, client_ca_subject: updated.clientCaSubject,
        upstream: updated.upstream, upstream_algorithm: updated.upstreamAlgorithm,
        health_check_path: updated.healthCheckPath, tags: updated.tags, description: updated.description});
      await loadDomainsFromApi();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to update domain'); }
    finally { mutation.current = false; }
  };
  const handleDeleteDomain = async (target: DomainItem) => {
    if (mutation.current) return;
    mutation.current = true; request.current++;
    try {
      await domainsApi.delete(target.id);
      if (selectedDomainId === target.id) setSelectedDomainId(null);
      await loadDomainsFromApi();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to delete domain'); }
    finally { mutation.current = false; }
  };
  const handleToggleStatus = (target: DomainItem) => {
    void handleUpdateDomain({...target, status: target.status === 'Active' ? 'Inactive' : 'Active'});
  };
  const handleAddTag = (id: string, tag: string) => {
    const target = domains.find(d => d.id === id);
    if (target && !target.tags.includes(tag)) void handleUpdateDomain({...target, tags: [...target.tags, tag]});
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 font-sans min-w-0">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Status shows saved routing intent. Node activation is asynchronous. Edge TLS certificates are not provisioned by this runtime.</p>
      {/* Top Header & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground font-medium mb-1">
            Domains <span className="mx-1.5 text-border">/</span>{' '}
            <span className="text-foreground">All Domains</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Domains
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your domains, subdomains, TLS certificates and upstream origins.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/domains/create')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-all duration-150 cursor-pointer shadow-sm active:scale-95"
          >
            <Plus className="w-4 h-4" />
            <span>Add Domain</span>
          </button>
        </div>
      </div>

      {/* 4 Stat Cards */}
      <DomainsStats
        domains={domains}
        selectedFilter={statFilter}
        onSelectFilter={setStatFilter}
      />

      {/* Search & Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 bg-card border border-border rounded-lg p-3 shadow-xs">
        {/* Search Bar */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search domain, upstream, tag..."
            className="w-full bg-background border border-input text-foreground text-xs rounded-md pl-8 pr-3 py-1.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>

        {/* Status Filter */}
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none bg-background border border-input text-foreground text-xs rounded-md pl-3 pr-8 py-1.5 focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="ALL">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* TLS Types Filter */}
        <div className="relative">
          <select
            value={tlsFilter}
            onChange={(e) => setTlsFilter(e.target.value)}
            className="appearance-none bg-background border border-input text-foreground text-xs rounded-md pl-3 pr-8 py-1.5 focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="ALL">All TLS Types</option>
            <option value="Let's Encrypt">Let's Encrypt</option>
            <option value="Custom Cert">Custom Cert</option>
            <option value="mTLS">mTLS</option>
            <option value="Self-signed">Self-signed</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Tags Filter */}
        <div className="relative">
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="appearance-none bg-background border border-input text-foreground text-xs rounded-md pl-3 pr-8 py-1.5 focus:outline-none focus:border-primary cursor-pointer"
          >
            <option value="ALL">All Tags</option>
            {allUniqueTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>

        {/* Refresh Button */}
        <button
          type="button"
          onClick={handleRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-foreground text-xs font-medium transition-colors cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-500 ${
              isRefreshing ? 'rotate-180 animate-spin text-primary' : ''
            }`}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Main Content Layout (Split Screen: Table on Left + Side Drawer on Right) */}
      <div className="flex flex-col lg:flex-row items-start gap-4 transition-all duration-300">
        {/* Left Side: Domains Table */}
        <div className="flex-1 min-w-0 w-full transition-all duration-300">
          <DomainsTable
            domains={filteredDomains}
            selectedDomainId={selectedDomainId}
            onSelectDomain={(item) => {
              if (selectedDomainId === item.id) {
                // If already open, clicking same row can keep or toggle
                setSelectedDomainId(item.id);
              } else {
                setSelectedDomainId(item.id);
              }
            }}
            onEditDomain={(item) => navigate(`/domains/${item.id}/edit`)}
            onDeleteDomain={(item) => setDeletingDomain(item)}
            onToggleStatus={handleToggleStatus}
          />
        </div>

        {/* Right Side: Detail Drawer Panel */}
        {selectedDomain && (
          <DomainDrawer
            domain={selectedDomain}
            onClose={() => setSelectedDomainId(null)}
            onEdit={(item) => navigate(`/domains/${item.id}/edit`)}
            onDelete={(item) => setDeletingDomain(item)}
            onAddTag={handleAddTag}
            onUpdateDomain={handleUpdateDomain}
          />
        )}
      </div>

      {/* Modals & Dialogs */}
      <DeleteDomainDialog
        isOpen={!!deletingDomain}
        domain={deletingDomain}
        onClose={() => setDeletingDomain(null)}
        onConfirm={handleDeleteDomain}
      />

    </div>
  );
}
