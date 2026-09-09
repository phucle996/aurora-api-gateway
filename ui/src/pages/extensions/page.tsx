import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../../lib/fetcher';
import {
  ExtensionItem,
  ExtensionCategory,
  ExtensionsApiResponse,
  ExtensionStatsData,
} from './types';
import { ExtensionStats } from './components/ExtensionStats';
import { ExtensionFilters } from './components/ExtensionFilters';
import { ExtensionCard } from './components/ExtensionCard';
import { ExtensionTable } from './components/ExtensionTable';
import { ExtensionConfigModal } from './components/ExtensionConfigModal';
import { Blocks, RotateCw, AlertCircle, RefreshCw } from 'lucide-react';

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExtensionCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Interactive states
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({});
  const [configuringExt, setConfiguringExt] = useState<ExtensionItem | null>(null);

  const fetchExtensions = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await api.get<ExtensionsApiResponse>('/api/v1/extensions');
      setExtensions(res.extensions || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch extensions catalog');
    } finally {
      setLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchExtensions();
  }, []);

  // Compute stats
  const stats: ExtensionStatsData = useMemo(() => {
    let enabled = 0;
    const byCategory: Record<string, number> = {
      security: 0,
      observability: 0,
      traffic: 0,
      runtime: 0,
      auth: 0,
    };

    extensions.forEach((ext) => {
      if (ext.enabled) enabled++;
      if (byCategory[ext.category] !== undefined) {
        byCategory[ext.category]++;
      }
    });

    return {
      total: extensions.length,
      enabled,
      disabled: Math.max(0, extensions.length - enabled),
      byCategory,
    };
  }, [extensions]);

  // Filter extensions
  const filteredExtensions = useMemo(() => {
    return extensions.filter((ext) => {
      // Category filter
      if (selectedCategory !== 'all' && ext.category !== selectedCategory) {
        return false;
      }

      // Status filter
      if (statusFilter === 'enabled' && !ext.enabled) return false;
      if (statusFilter === 'disabled' && ext.enabled) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = ext.name.toLowerCase().includes(q);
        const matchID = ext.id.toLowerCase().includes(q);
        const matchDesc = ext.description.toLowerCase().includes(q);
        const matchCat = ext.category.toLowerCase().includes(q);
        if (!matchName && !matchID && !matchDesc && !matchCat) return false;
      }

      return true;
    });
  }, [extensions, selectedCategory, statusFilter, searchQuery]);

  // Toggle extension status
  const handleToggleStatus = async (id: string, newEnabled: boolean) => {
    setTogglingIds((prev) => ({ ...prev, [id]: true }));

    // Optimistic update
    setExtensions((prev) =>
      prev.map((item) => (item.id === id ? { ...item, enabled: newEnabled } : item))
    );

    try {
      await api.put(`/api/v1/extensions/${encodeURIComponent(id)}/status`, {
        enabled: newEnabled,
      });
    } catch (e) {
      // Rollback on failure
      setExtensions((prev) =>
        prev.map((item) => (item.id === id ? { ...item, enabled: !newEnabled } : item))
      );
      setError(e instanceof Error ? e.message : 'Failed to update extension status');
    } finally {
      setTogglingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  // Save extension configuration
  const handleSaveConfig = async (id: string, configJSON: string): Promise<boolean> => {
    try {
      await api.put(`/api/v1/extensions/${encodeURIComponent(id)}/config`, {
        config_json: configJSON,
      });

      // Update in local state
      setExtensions((prev) =>
        prev.map((item) => (item.id === id ? { ...item, config_json: configJSON } : item))
      );
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update extension config');
      return false;
    }
  };

  return (
    <div className="p-6 w-full space-y-6 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Blocks className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                Extensions Hub
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage, configure, and synchronize dynamic data plane extensions across your NGINX
                WAF cluster.
              </p>
            </div>
          </div>
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => void fetchExtensions(true)}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-border text-xs font-medium text-muted-foreground hover:text-foreground bg-card hover:bg-muted/50 transition-colors cursor-pointer shadow-2xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/40 rounded-sm flex items-center justify-between text-xs text-rose-700 dark:text-rose-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchExtensions(true)}
            className="underline hover:no-underline font-medium cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Stats */}
      <ExtensionStats stats={stats} />

      {/* Filters & Navigation */}
      <ExtensionFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        categoryCounts={stats.byCategory}
      />

      {/* Main Content: Cards or Table */}
      {loading ? (
        <div className="py-20 text-center text-muted-foreground flex flex-col items-center justify-center gap-2.5">
          <RotateCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-xs font-medium">Loading extensions catalog...</span>
        </div>
      ) : filteredExtensions.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground border border-border border-dashed rounded-md bg-muted/10 p-8 space-y-2">
          <Blocks className="w-8 h-8 mx-auto text-muted-foreground opacity-50" />
          <p className="text-sm font-semibold text-foreground">No extensions found</p>
          <p className="text-xs text-muted-foreground">
            No extension matched your search query or selected category filter.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredExtensions.map((ext) => (
            <ExtensionCard
              key={ext.id}
              extension={ext}
              isToggling={Boolean(togglingIds[ext.id])}
              onToggle={handleToggleStatus}
              onConfigure={(item) => setConfiguringExt(item)}
            />
          ))}
        </div>
      ) : (
        <ExtensionTable
          extensions={filteredExtensions}
          togglingIds={togglingIds}
          onToggle={handleToggleStatus}
          onConfigure={(item) => setConfiguringExt(item)}
        />
      )}

      {/* Configuration Modal */}
      <ExtensionConfigModal
        extension={configuringExt}
        onClose={() => setConfiguringExt(null)}
        onSave={handleSaveConfig}
      />
    </div>
  );
}
