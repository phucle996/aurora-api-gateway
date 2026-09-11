import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Plus, RefreshCw, Search, Route, Filter, ChevronDown } from 'lucide-react';
import type { RouteItem } from './types';
import { routesApi } from '../../lib/api/routes';
import { RouteStats } from './sections/RouteStats';
import { RouteTable } from './sections/RouteTable';
import { RouteModal } from './sections/RouteModal';
import { DeleteRouteDialog } from './sections/DeleteRouteDialog';

export default function RoutesPage() {
  const [routes, setRoutes] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [hostFilter, setHostFilter] = useState<string>('ALL');
  const [upstreamFilter, setUpstreamFilter] = useState<string>('ALL');
  const [statFilter, setStatFilter] = useState<string | null>(null);

  // Modals state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<RouteItem | null>(null);
  const [deletingRoute, setDeletingRoute] = useState<RouteItem | null>(null);
  const [togglingIds, setTogglingIds] = useState<Record<string, boolean>>({});

  const requestSequence = useRef(0);

  const fetchRoutes = useCallback(async (showSpin = false) => {
    const seq = ++requestSequence.current;
    if (showSpin) setIsRefreshing(true);

    try {
      const res = await routesApi.list({ limit: 200 });
      if (seq === requestSequence.current) {
        setRoutes(res.items || []);
        setError(null);
      }
    } catch (err: any) {
      if (seq === requestSequence.current) {
        setError(err?.message || 'Failed to load routes from backend');
      }
    } finally {
      if (seq === requestSequence.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchRoutes();
    const interval = setInterval(() => void fetchRoutes(), 5000);
    return () => {
      clearInterval(interval);
      requestSequence.current++;
    };
  }, [fetchRoutes]);

  // Unique hosts and upstreams for filter dropdowns
  const availableHosts = useMemo(() => {
    const set = new Set<string>();
    routes.forEach((r) => set.add(r.host));
    return Array.from(set).sort();
  }, [routes]);

  const availableUpstreams = useMemo(() => {
    const set = new Set<string>();
    routes.forEach((r) => set.add(r.upstream_name));
    return Array.from(set).sort();
  }, [routes]);

  // Filtered & sorted routes
  const filteredRoutes = useMemo(() => {
    return routes
      .filter((r) => {
        // Search match (name, host, path, upstream, description)
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match =
            r.name.toLowerCase().includes(q) ||
            r.host.toLowerCase().includes(q) ||
            r.path.toLowerCase().includes(q) ||
            r.upstream_name.toLowerCase().includes(q) ||
            r.id.toLowerCase().includes(q) ||
            (r.description && r.description.toLowerCase().includes(q));
          if (!match) return false;
        }

        // Host filter
        if (hostFilter !== 'ALL' && r.host !== hostFilter) {
          return false;
        }

        // Upstream filter
        if (upstreamFilter !== 'ALL' && r.upstream_name !== upstreamFilter) {
          return false;
        }

        // Stat Card Filter
        if (statFilter === 'active' && !r.enabled) return false;
        if (statFilter === 'websocket' && !r.websocket) return false;
        if (statFilter === 'strip_path' && !r.strip_path) return false;

        return true;
      })
      // Sort by host ASC, then longest path length DESC, then priority DESC
      .sort((a, b) => {
        if (a.host !== b.host) return a.host.localeCompare(b.host);
        if (b.path.length !== a.path.length) return b.path.length - a.path.length;
        return b.priority - a.priority;
      });
  }, [routes, searchQuery, hostFilter, upstreamFilter, statFilter]);

  // Optimistic toggle handler
  const handleToggle = async (route: RouteItem, nextEnabled: boolean) => {
    setTogglingIds((prev) => ({ ...prev, [route.id]: true }));
    setRoutes((prev) =>
      prev.map((r) => (r.id === route.id ? { ...r, enabled: nextEnabled } : r))
    );

    try {
      await routesApi.toggle(route.id, nextEnabled);
    } catch (err) {
      console.error('Failed to toggle route:', err);
      // Revert on error
      setRoutes((prev) =>
        prev.map((r) => (r.id === route.id ? { ...r, enabled: !nextEnabled } : r))
      );
    } finally {
      setTogglingIds((prev) => {
        const next = { ...prev };
        delete next[route.id];
        return next;
      });
    }
  };

  return (
    <div className="p-6 space-y-6 w-full font-sans">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Route className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Routing Engine
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Manage host and path mappings to backend upstreams, WebSockets, and prefix stripping.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fetchRoutes(true)}
            disabled={isRefreshing}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-xl transition-colors cursor-pointer border border-border/70 bg-card/60"
            title="Refresh routes"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => {
              setEditingRoute(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Create Route</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <RouteStats
        routes={routes}
        selectedFilter={statFilter}
        onSelectFilter={setStatFilter}
      />

      {/* Controls Bar: Search & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/50 border border-border/60 p-3 rounded-xl backdrop-blur-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, host, path, upstream..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-background/80 border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Host Filter */}
          <div className="relative">
            <select
              value={hostFilter}
              onChange={(e) => setHostFilter(e.target.value)}
              className="pl-2.5 pr-7 py-1.5 text-xs font-mono bg-background/80 border border-border/80 rounded-lg text-foreground appearance-none cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary/40"
            >
              <option value="ALL">All Hosts ({availableHosts.length})</option>
              {availableHosts.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>

          {/* Upstream Filter */}
          <div className="relative">
            <select
              value={upstreamFilter}
              onChange={(e) => setUpstreamFilter(e.target.value)}
              className="pl-2.5 pr-7 py-1.5 text-xs font-mono bg-background/80 border border-border/80 rounded-lg text-foreground appearance-none cursor-pointer focus:outline-hidden focus:ring-2 focus:ring-primary/40"
            >
              <option value="ALL">All Upstreams ({availableUpstreams.length})</option>
              {availableUpstreams.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          </div>

          {/* Reset Filters button if any active */}
          {(searchQuery || hostFilter !== 'ALL' || upstreamFilter !== 'ALL' || statFilter) && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setHostFilter('ALL');
                setUpstreamFilter('ALL');
                setStatFilter(null);
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/60 hover:bg-muted rounded-lg transition-colors cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Error alert */}
      {error && (
        <div className="p-3.5 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchRoutes(true)}
            className="underline hover:text-destructive/80 cursor-pointer font-medium ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main Table */}
      {loading && routes.length === 0 ? (
        <div className="p-12 text-center text-xs text-muted-foreground bg-card/40 border border-border/60 rounded-xl">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-primary" />
          Loading routing table...
        </div>
      ) : (
        <RouteTable
          routes={filteredRoutes}
          onEdit={(r) => {
            setEditingRoute(r);
            setIsModalOpen(true);
          }}
          onDelete={(r) => setDeletingRoute(r)}
          onToggle={handleToggle}
          togglingIds={togglingIds}
        />
      )}

      {/* Create / Edit Modal */}
      <RouteModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => void fetchRoutes()}
        editingRoute={editingRoute}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteRouteDialog
        isOpen={Boolean(deletingRoute)}
        route={deletingRoute}
        onClose={() => setDeletingRoute(null)}
        onSuccess={() => void fetchRoutes()}
      />
    </div>
  );
}
