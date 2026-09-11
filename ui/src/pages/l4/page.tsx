import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Network, Plus, RefreshCw, AlertCircle } from 'lucide-react';
import { l4Api, L4ServiceItem, CreateL4ServicePayload } from '../../lib/api/l4';
import { upstreamsApi } from '../../lib/api/upstreams';
import type { UpstreamItem } from '../upstreams/types';
import { L4Stats } from './sections/L4Stats';
import { L4ServiceTable } from './sections/L4ServiceTable';
import { L4ServiceModal } from './sections/L4ServiceModal';
import { DeleteL4ServiceDialog } from './sections/DeleteL4ServiceDialog';

export default function L4GatewayPage() {
  const [services, setServices] = useState<L4ServiceItem[]>([]);
  const [availableUpstreams, setAvailableUpstreams] = useState<UpstreamItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [protoFilter, setProtoFilter] = useState<'all' | 'tcp' | 'udp'>('all');

  // Modals state
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<L4ServiceItem | null>(null);
  const [deletingService, setDeletingService] = useState<L4ServiceItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = useCallback(async (showSpin = false) => {
    if (showSpin) setIsRefreshing(true);
    try {
      const [svcRes, upRes] = await Promise.all([
        l4Api.listServices({ limit: 100 }),
        upstreamsApi.list({ limit: 100 }).catch(() => ({ items: [] as UpstreamItem[] })),
      ]);
      setServices(svcRes.items || []);
      setAvailableUpstreams(upRes.items || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load L4 Gateway configurations');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Open Create/Edit Modal
  const handleOpenModal = (item?: L4ServiceItem) => {
    setEditingService(item || null);
    setServiceModalOpen(true);
  };

  // Save Service
  const handleSaveService = async (payload: CreateL4ServicePayload) => {
    if (editingService) {
      await l4Api.updateService(editingService.id, payload);
    } else {
      await l4Api.createService(payload);
    }
    await fetchData();
  };

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
        svc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        svc.upstream_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (svc.direct_endpoint && svc.direct_endpoint.toLowerCase().includes(searchQuery.toLowerCase())) ||
        svc.listen_port.toString().includes(searchQuery);
      const matchesProto = protoFilter === 'all' || svc.protocol.toLowerCase() === protoFilter;
      return matchesSearch && matchesProto;
    });
  }, [services, searchQuery, protoFilter]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              L4 Stream Gateway
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              TCP / UDP Stream Proxying, IP CIDR Access Control & Flexible Upstream / Direct Endpoint Forwarding
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void fetchData(true)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            Add L4 Service
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* 1. Stats Section */}
      <L4Stats services={services} />

      {/* 2. Table Section */}
      <L4ServiceTable
        services={filteredServices}
        loading={loading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        protoFilter={protoFilter}
        onProtoFilterChange={setProtoFilter}
        onEdit={handleOpenModal}
        onDelete={(svc) => setDeletingService(svc)}
        onToggleStatus={handleToggleStatus}
        onCreateNew={() => handleOpenModal()}
      />

      {/* 3. Modal Section */}
      <L4ServiceModal
        isOpen={serviceModalOpen}
        onClose={() => setServiceModalOpen(false)}
        service={editingService}
        availableUpstreams={availableUpstreams}
        onSave={handleSaveService}
      />

      {/* 4. Delete Confirmation Dialog */}
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
