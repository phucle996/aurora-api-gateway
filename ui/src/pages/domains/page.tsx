import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
import { AddDomainModal } from './sections/AddDomainModal';
import { EditDomainModal } from './sections/EditDomainModal';
import { DeleteDomainDialog } from './sections/DeleteDomainDialog';
import { ImportDomainsModal } from './sections/ImportDomainsModal';

export default function DomainsPage() {
  const navigate = useNavigate();
  const [domains, setDomains] = useState<DomainItem[]>(() => {
    try {
      const saved = localStorage.getItem('aurora_waf_domains');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [];
  });

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
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editingDomain, setEditingDomain] = useState<DomainItem | null>(null);
  const [deletingDomain, setDeletingDomain] = useState<DomainItem | null>(null);

  // Fetch from backend API
  const loadDomainsFromApi = useCallback(async () => {
    try {
      const res = await domainsApi.list({ limit: 100 });
      if (res && res.items) {
        setDomains(res.items.map((item: any) => ({
          ...item,
          id: String(item.id),
          tags: item.tags || [],
          nodeBindings: item.nodeBindings || [],
          recentActivities: item.recentActivities || [],
        })));
      }
    } catch (err) {
      console.warn('Backend /api/v1/domains failed to fetch:', err);
    }
  }, []);

  useEffect(() => {
    void loadDomainsFromApi();
  }, [loadDomainsFromApi]);

  // Persist helper
  const saveDomains = (updated: DomainItem[]) => {
    setDomains(updated);
    try {
      localStorage.setItem('aurora_waf_domains', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

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
  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  const handleCreateDomain = (
    newDomain: Omit<
      DomainItem,
      | 'id'
      | 'createdAt'
      | 'updatedAt'
      | 'createdBy'
      | 'rulesCount'
      | 'policiesCount'
      | 'ipRulesCount'
      | 'rateLimitsCount'
    >
  ) => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const created: DomainItem = {
      ...newDomain,
      id: `dom-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      createdBy: 'admin',
      rulesCount: 0,
      policiesCount: 0,
      ipRulesCount: 0,
      rateLimitsCount: 0,
      recentActivities: [
        {
          id: `act-${Date.now()}`,
          type: 'created',
          title: 'Domain created',
          description: 'Initial deployment configuration',
          timestamp: now,
          color: 'slate',
        },
      ],
    };
    const next = [created, ...domains];
    saveDomains(next);
    setSelectedDomainId(created.id);
  };

  const handleUpdateDomain = (updated: DomainItem) => {
    const next = domains.map((d) => (d.id === updated.id ? updated : d));
    saveDomains(next);
  };

  const handleDeleteDomain = (target: DomainItem) => {
    const next = domains.filter((d) => d.id !== target.id);
    saveDomains(next);
    if (selectedDomainId === target.id) {
      setSelectedDomainId(null);
    }
  };

  const handleToggleStatus = (target: DomainItem) => {
    const newStatus: DomainStatus = target.status === 'Active' ? 'Inactive' : 'Active';
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const updated: DomainItem = {
      ...target,
      status: newStatus,
      updatedAt: now,
      recentActivities: [
        {
          id: `act-${Date.now()}`,
          type: 'updated',
          title: `Status changed to ${newStatus}`,
          description: 'Updated via domain table action',
          timestamp: now,
          color: newStatus === 'Active' ? 'emerald' : 'amber',
        },
        ...(target.recentActivities || []),
      ],
    };
    handleUpdateDomain(updated);
  };

  const handleAddTag = (domainId: string, tag: string) => {
    const target = domains.find((d) => d.id === domainId);
    if (!target) return;
    if (target.tags.includes(tag)) return;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const updated: DomainItem = {
      ...target,
      tags: [...target.tags, tag],
      updatedAt: now,
    };
    handleUpdateDomain(updated);
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 font-sans min-w-0">
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
            onEditDomain={(item) => setEditingDomain(item)}
            onDeleteDomain={(item) => setDeletingDomain(item)}
            onToggleStatus={handleToggleStatus}
          />
        </div>

        {/* Right Side: Detail Drawer Panel */}
        {selectedDomain && (
          <DomainDrawer
            domain={selectedDomain}
            onClose={() => setSelectedDomainId(null)}
            onEdit={(item) => setEditingDomain(item)}
            onDelete={(item) => setDeletingDomain(item)}
            onAddTag={handleAddTag}
            onUpdateDomain={handleUpdateDomain}
          />
        )}
      </div>

      {/* Modals & Dialogs */}
      <AddDomainModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onAdd={handleCreateDomain}
      />

      <EditDomainModal
        isOpen={!!editingDomain}
        domain={editingDomain}
        onClose={() => setEditingDomain(null)}
        onSave={handleUpdateDomain}
      />

      <DeleteDomainDialog
        isOpen={!!deletingDomain}
        domain={deletingDomain}
        onClose={() => setDeletingDomain(null)}
        onConfirm={handleDeleteDomain}
      />

      <ImportDomainsModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        onImport={(importedList) => {
          const next = [...importedList, ...domains];
          saveDomains(next);
        }}
      />
    </div>
  );
}
