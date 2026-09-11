import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Network, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { l4Api, L4ServiceItem } from '../../lib/api/l4';
import { upstreamsApi } from '../../lib/api/upstreams';
import type { UpstreamItem } from '../upstreams/types';
import { L4Stats } from './sections/L4Stats';
import { L4ServiceTable } from './sections/L4ServiceTable';
import { DeleteL4ServiceDialog } from './sections/DeleteL4ServiceDialog';

export default function L4GatewayPage() {
  const navigate = useNavigate();
  const [services, setServices] = useState<L4ServiceItem[]>([]);
  const [availableUpstreams, setAvailableUpstreams] = useState<UpstreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [protoFilter, setProtoFilter] = useState<'all' | 'tcp' | 'udp'>('all');
  const [statFilter, setStatFilter] = useState<string | null>(null);

  // Deletion state
  const [deletingService, setDeletingService] = useState<L4ServiceItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const requestSequence = useRef(0);

  const fetchData = useCallback(async (showSpin = false) => {
    const seq = ++requestSequence.current;
    if (showSpin) setIsRefreshing(true);
    try {
      const [svcRes, upRes] = await Promise.all([
        l4Api.listServices({ limit: 100 }),
        upstreamsApi.list({ limit: 100 }).catch(() => ({ items: [] as UpstreamItem[] })),
      ]);
      if (seq === requestSequence.current) {
        setServices(svcRes.items || []);
        setAvailableUpstreams(upRes.items || []);
        setError(null);
      }
    } catch (err: any) {
      if (seq === requestSequence.current) {
        setError(err?.message || 'Failed to load L4 Gateway configurations');
      }
    } finally {
      if (seq === requestSequence.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Toggle Status
  const handleToggleStatus = async (item: L4ServiceItem) => {
    try {
      await l4Api.toggleService(item.id, !item.enabled);
      void fetchData();
    } catch (err: any) {
      alert(err?.message || 'Error updating service status');
    }
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!deletingService) return;
    setIsDeleting(true);
    try {
      await l4Api.deleteService(deletingService.id);
      setDeletingService(null);
      await fetchData();
    } catch (err: any) {
      alert(err?.message || 'Error deleting service');
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered Services
  const filteredServices = useMemo(() => {
    return services.filter((svc) => {
      const matchesSearch =
        !searchQuery.trim() ||
        svc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        svc.upstream_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (svc.direct_endpoint && svc.direct_endpoint.toLowerCase().includes(searchQuery.toLowerCase())) ||
        svc.listen_port.toString().includes(searchQuery);

      const matchesProto = protoFilter === 'all' || svc.protocol.toLowerCase() === protoFilter;

      let matchesStat = true;
      if (statFilter === 'tcp') matchesStat = svc.protocol.toLowerCase() === 'tcp';
      if (statFilter === 'udp') matchesStat = svc.protocol.toLowerCase() === 'udp';
      if (statFilter === 'acl') {
        try {
          const acls = JSON.parse(svc.acl_rules_json || '[]');
          matchesStat = Array.isArray(acls) && acls.length > 0;
        } catch {
          matchesStat = false;
        }
      }

      return matchesSearch && matchesProto && matchesStat;
    });
  }, [services, searchQuery, protoFilter, statFilter]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setProtoFilter('all');
    setStatFilter(null);
  };

  return (
    <div className="p-6 space-y-6 w-full font-sans">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Network className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                L4 Stream Gateway
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                TCP & UDP Stream Proxying, IP CIDR Access Control & Flexible Upstream / Direct Endpoint Forwarding
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void fetchData(true)}
            disabled={isRefreshing}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-xl transition-colors cursor-pointer border border-border/70 bg-card/60"
            title="Refresh services"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => navigate('/l4/create')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add L4 Service</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2.5 text-xs font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* 1. Stats Section */}
      <L4Stats
        services={services}
        selectedFilter={statFilter}
        onSelectFilter={(f) => setStatFilter(f)}
      />

      {/* 2. Controls & Table Section */}
      <L4ServiceTable
        services={filteredServices}
        loading={loading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        protoFilter={protoFilter}
        onProtoFilterChange={setProtoFilter}
        selectedStatFilter={statFilter}
        onClearFilters={handleClearFilters}
        onEdit={(svc) => navigate(`/l4/${svc.id}/edit`)}
        onDelete={(svc) => setDeletingService(svc)}
        onToggleStatus={handleToggleStatus}
        onCreateNew={() => navigate('/l4/create')}
      />

      {/* 3. Delete Confirmation Dialog */}
      <DeleteL4ServiceDialog
        isOpen={Boolean(deletingService)}
        onClose={() => setDeletingService(null)}
        service={deletingService}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}

