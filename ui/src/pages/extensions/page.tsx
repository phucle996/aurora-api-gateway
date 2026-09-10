import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../../lib/fetcher';
import {
  ExtensionItem,
  ExtensionCategory,
  ExtensionsApiResponse,
  ExtensionStatsData,
} from './types';
import { EXTENSIONS_CATALOG, CATEGORIES_META } from './data/catalog';
import { ExtensionStats } from './components/ExtensionStats';
import { ExtensionFilters } from './components/ExtensionFilters';
import { ExtensionCard } from './components/ExtensionCard';
import { ExtensionTable } from './components/ExtensionTable';
import { ExtensionConfigModal } from './components/ExtensionConfigModal';
import { Blocks, RotateCw, AlertCircle, RefreshCw, Sparkles } from 'lucide-react';

export default function ExtensionsPage() {
  const [extensions, setExtensions] = useState<ExtensionItem[]>(EXTENSIONS_CATALOG);
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
      const apiItems = res.extensions || [];

      if (apiItems.length > 0) {
        const apiMap = new Map<string, ExtensionItem>();
        apiItems.forEach((item) => apiMap.set(item.id, item));

        // Merge catalog metadata with live API state
        const merged: ExtensionItem[] = EXTENSIONS_CATALOG.map((catItem) => {
          const live = apiMap.get(catItem.id);
          if (live) {
            return {
              ...catItem,
              enabled: live.enabled,
              config_json: live.config_json || catItem.config_json,
              version: live.version || catItem.version,
            };
          }
          return catItem;
        });

        // Append custom dynamic extensions that might not be in the static catalog
        apiItems.forEach((live) => {
          if (!EXTENSIONS_CATALOG.some((c) => c.id === live.id)) {
            merged.push(live);
          }
        });

        setExtensions(merged);
      } else {
        setExtensions(EXTENSIONS_CATALOG);
      }
      setError(null);
    } catch (e) {
      // If API fails, fall back cleanly to the static catalog
      setError(e instanceof Error ? e.message : 'Failed to fetch live extensions from API');
    } finally {
      setLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchExtensions();
  }, []);

  // Compute stats across 11 groups
  const stats: ExtensionStatsData = useMemo(() => {
    let enabled = 0;
    const byCategory: Record<string, number> = {
      security_engine: 0,
      authentication: 0,
      authorization_security: 0,
      traffic_control: 0,
      request_transformation: 0,
      response_transformation: 0,
      observability: 0,
      resilience_upstream: 0,
      cache_content: 0,
      integration_runtime: 0,
      ai_gateway: 0,
    };

    extensions.forEach((ext) => {
      if (ext.enabled) enabled++;

      // Map legacy category keys to modern group keys if needed
      let catKey = ext.category;
      if (catKey === 'security') catKey = 'security_engine';
      if (catKey === 'auth') catKey = 'authentication';
      if (catKey === 'traffic') catKey = 'traffic_control';
      if (catKey === 'runtime') catKey = 'integration_runtime';

      if (byCategory[catKey] !== undefined) {
        byCategory[catKey]++;
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
      // Normalize category comparison
      let catKey = ext.category;
      if (catKey === 'security') catKey = 'security_engine';
      if (catKey === 'auth') catKey = 'authentication';
      if (catKey === 'traffic') catKey = 'traffic_control';
      if (catKey === 'runtime') catKey = 'integration_runtime';

      // Category filter
      if (selectedCategory !== 'all' && catKey !== selectedCategory) {
        return false;
      }

      // Status filter
      if (statusFilter === 'enabled' && !ext.enabled) return false;
      if (statusFilter === 'disabled' && ext.enabled) return false;

      // Search query (matches name, id, description, category, and tags)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = ext.name.toLowerCase().includes(q);
        const matchID = ext.id.toLowerCase().includes(q);
        const matchDesc = ext.description.toLowerCase().includes(q);
        const matchCat = ext.category.toLowerCase().includes(q);
        const matchTags = ext.tags ? ext.tags.some((t) => t.toLowerCase().includes(q)) : false;

        if (!matchName && !matchID && !matchDesc && !matchCat && !matchTags) return false;
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

  const selectedCategoryMeta =
    selectedCategory !== 'all' ? CATEGORIES_META[selectedCategory] : null;

  return (
    <div className="p-6 w-full space-y-6 font-sans max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-primary/10 text-primary shadow-2xs">
              <Blocks className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground tracking-tight">
                  Extensions Hub
                </h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
                  <Sparkles className="w-3 h-3" />
                  115 Plugins Available
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Declarative security engines, API gateway capabilities, traffic shaping, and runtime
                extensions.
              </p>
            </div>
          </div>
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => void fetchExtensions(true)}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground bg-card hover:bg-muted/50 transition-colors cursor-pointer shadow-2xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-500/40 rounded-md flex items-center justify-between text-xs text-rose-700 dark:text-rose-400 animate-in fade-in">
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
      <ExtensionStats
        stats={stats}
        selectedCategory={selectedCategory}
        onSelectCategory={(cat) => setSelectedCategory(cat)}
      />

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

      {/* Category Banner if filtered */}
      {selectedCategoryMeta && (
        <div className="p-3 bg-card/60 border border-border/80 rounded-lg flex items-center justify-between text-xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${selectedCategoryMeta.badgeClass}`}
            >
              {selectedCategoryMeta.label}
            </span>
            <span className="text-muted-foreground">{selectedCategoryMeta.description}</span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className="text-primary hover:underline font-medium text-[11px] cursor-pointer"
          >
            Show all groups
          </button>
        </div>
      )}

      {/* Main Content: Cards or Table */}
      {loading ? (
        <div className="py-20 text-center text-muted-foreground flex flex-col items-center justify-center gap-2.5">
          <RotateCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-xs font-medium">Loading extensions catalog...</span>
        </div>
      ) : filteredExtensions.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground border border-border border-dashed rounded-lg bg-muted/10 p-8 space-y-2">
          <Blocks className="w-8 h-8 mx-auto text-muted-foreground opacity-50" />
          <p className="text-sm font-semibold text-foreground">No extensions found</p>
          <p className="text-xs text-muted-foreground">
            No extension matched your search query or selected category filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              setStatusFilter('all');
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer"
          >
            Reset all filters
          </button>
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
