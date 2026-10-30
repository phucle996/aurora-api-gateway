import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Globe,
  Route as RouteIcon,
  Layers,
  Sparkles,
  Plus,
  X,
  ArrowRight,
  Zap,
  Shield,
  Gauge,
  CheckCircle2,
  GripVertical,
  Pencil,
  Ban,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import type { RouteItem } from '../types';
import { extensionsApi } from '../../../lib/api';
import {
  DATAPLANE_EXTENSION_CATALOG,
  DataplaneExtensionMeta,
  ExtensionProfileOption,
  normalizeExtensionKey,
  resolveExtensionProfiles,
} from '../../extensions/data/extensionProfiles';
import { getRouteExtensionSelectedProfile } from './RouteExtensionSwitches';

// Dataplane execution order across Access & Filter phases
const EXECUTION_ORDER: string[] = [
  'ip-restriction',
  'connection-limit',
  'resource-limit',
  'rate-limit',
  'jwt-authentication',
  'traffic-shaper',
  'response-cache',
  'response-compression',
];

interface RouteVisualCanvasProps {
  routes: RouteItem[];
  onEditRoute: (route: RouteItem) => void;
  onToggleRoute: (route: RouteItem, nextEnabled: boolean) => void;
  onUpdateRoutePlugins: (route: RouteItem, nextPluginsJson: string) => Promise<void>;
  savingRouteIds: Record<string, boolean>;
}

function parsePluginsObj(raw?: string): Record<string, any> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>;
    }
  } catch {
    // ignore malformed json
  }
  return {};
}

export const RouteVisualCanvas: React.FC<RouteVisualCanvasProps> = ({
  routes,
  onEditRoute,
  onToggleRoute,
  onUpdateRoutePlugins,
  savingRouteIds,
}) => {
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(
    routes[0]?.id ?? null
  );
  const [dragOverRouteId, setDragOverRouteId] = useState<string | null>(null);
  const [liveConfigsByExt, setLiveConfigsByExt] = useState<Record<string, string>>({});
  const [dockCategory, setDockCategory] = useState<'all' | 'performance' | 'security' | 'traffic'>('all');

  useEffect(() => {
    if (!selectedRouteId && routes.length > 0) {
      setSelectedRouteId(routes[0].id);
    } else if (selectedRouteId && !routes.some((r) => r.id === selectedRouteId)) {
      setSelectedRouteId(routes[0]?.id ?? null);
    }
  }, [routes, selectedRouteId]);

  useEffect(() => {
    let mounted = true;
    extensionsApi
      .list()
      .then((res) => {
        if (!mounted || !res?.extensions) return;
        const map: Record<string, string> = {};
        for (const ext of res.extensions) {
          const cleanKey = normalizeExtensionKey(ext.id || ext.name || '');
          if (cleanKey && ext.config_json) {
            map[cleanKey] = ext.config_json;
          }
        }
        setLiveConfigsByExt(map);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId]
  );

  // Group routes by host for visual tree layout
  const routesByHost = useMemo(() => {
    const groups = new Map<string, RouteItem[]>();
    for (const r of routes) {
      const host = r.host || '*';
      const list = groups.get(host) || [];
      list.push(r);
      groups.set(host, list);
    }
    return Array.from(groups.entries());
  }, [routes]);

  // Assign a profile to a route and persist immediately
  const assignProfileToRoute = async (
    route: RouteItem,
    extKey: string,
    profileId: string
  ) => {
    const currentObj = parsePluginsObj(route.plugins_json);
    const next: Record<string, any> = { ...currentObj, _mode: 'explicit' };
    delete next._profile;

    if (profileId === 'off') {
      next[extKey] = { enabled: false, profile: 'off' };
    } else {
      const profiles = resolveExtensionProfiles(extKey, liveConfigsByExt[extKey]);
      const chosen = profiles.find((p) => p.id === profileId);
      const entry: Record<string, any> = {
        enabled: true,
        profile: profileId,
      };
      if (chosen?.params && Object.keys(chosen.params).length > 0) {
        for (const [k, v] of Object.entries(chosen.params)) {
          if (k !== 'label' && k !== 'summary') {
            entry[k] = v;
          }
        }
      }
      next[extKey] = entry;
    }

    await onUpdateRoutePlugins(route, JSON.stringify(next));
  };

  // Clear all extensions on a route (Raw Passthrough)
  const setRoutePassthrough = async (route: RouteItem) => {
    const next = {
      _mode: 'explicit',
      _profile: 'passthrough',
    };
    await onUpdateRoutePlugins(route, JSON.stringify(next));
  };

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    extKey: string,
    profileId: string
  ) => {
    e.dataTransfer.setData(
      'application/aurora-profile',
      JSON.stringify({ extKey, profileId })
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDropOnRoute = async (
    e: React.DragEvent<HTMLDivElement>,
    route: RouteItem
  ) => {
    e.preventDefault();
    setDragOverRouteId(null);
    setSelectedRouteId(route.id);

    const raw = e.dataTransfer.getData('application/aurora-profile');
    if (!raw) return;
    try {
      const { extKey, profileId } = JSON.parse(raw) as {
        extKey: string;
        profileId: string;
      };
      if (extKey && profileId) {
        await assignProfileToRoute(route, extKey, profileId);
      }
    } catch {
      // ignore invalid drag payload
    }
  };

  const filteredCatalog = useMemo(() => {
    if (dockCategory === 'all') return DATAPLANE_EXTENSION_CATALOG;
    return DATAPLANE_EXTENSION_CATALOG.filter((ext) => ext.category === dockCategory);
  }, [dockCategory]);

  const orderedCatalog = useMemo(() => {
    return [...DATAPLANE_EXTENSION_CATALOG].sort((a, b) => {
      const ia = EXECUTION_ORDER.indexOf(a.key);
      const ib = EXECUTION_ORDER.indexOf(b.key);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, []);

  if (routes.length === 0) {
    return (
      <div className="bg-card/70 border border-border/70 rounded-2xl p-12 text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary mb-3">
          <RouteIcon className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Chưa có Route nào trên Canvas</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
          Hãy tạo một Route trước để bắt đầu kéo-thả và gán các Extension Profile trực tiếp trên Visual Canvas.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      {/* LEFT / CENTER: INTERACTIVE VISUAL CANVAS (8 cols) */}
      <div className="xl:col-span-8 relative rounded-2xl border border-border/80 bg-card/60 overflow-hidden shadow-sm">
        {/* Subtle Dot Matrix Canvas Background */}
        <div
          className="absolute inset-0 pointer-events-none opacity-25"
          style={{
            backgroundImage:
              'radial-gradient(circle, currentColor 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />

        {/* Canvas Top Bar */}
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border/70 bg-card/90 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
              Visual Route & Extension Pipeline Canvas
            </span>
            <span className="text-[11px] font-mono text-muted-foreground">
              (Host Ingress ➔ Route FFI Pipeline ➔ Target Upstream)
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>
              Kéo thả Profile từ cột phải vào Route hoặc chọn Route rồi bấm vào Profile để gán tức thì
            </span>
          </div>
        </div>

        {/* Canvas Nodes Body */}
        <div className="relative z-10 p-6 space-y-8">
          {routesByHost.map(([host, hostRoutes]) => (
            <div key={host} className="space-y-4">
              {/* Host Group Header Banner */}
              <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-primary/10 border border-primary/30 text-primary shadow-2xs">
                <Globe className="w-4 h-4" />
                <span className="text-xs font-bold font-mono">
                  Ingress Host: {host === '*' ? '* (All Domains)' : host}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-primary/20 text-[10px] font-mono font-semibold">
                  {hostRoutes.length} {hostRoutes.length === 1 ? 'route' : 'routes'}
                </span>
              </div>

              {/* Routes under this Host */}
              <div className="space-y-4 pl-3 md:pl-6 border-l-2 border-primary/25">
                {hostRoutes.map((route) => {
                  const isSelected = route.id === selectedRouteId;
                  const isDragOver = route.id === dragOverRouteId;
                  const isSaving = Boolean(savingRouteIds[route.id]);
                  const pluginsObj = parsePluginsObj(route.plugins_json);
                  const isPassthrough =
                    pluginsObj._profile === 'passthrough' || pluginsObj._profile === 'raw';

                  // Collect active extension profiles in execution order
                  const activePipeline: {
                    meta: DataplaneExtensionMeta;
                    profileId: string;
                    profiles: ExtensionProfileOption[];
                    currentProfile?: ExtensionProfileOption;
                  }[] = [];

                  if (!isPassthrough) {
                    for (const meta of orderedCatalog) {
                      const profiles = resolveExtensionProfiles(
                        meta.key,
                        liveConfigsByExt[meta.key]
                      );
                      const profId = getRouteExtensionSelectedProfile(
                        pluginsObj,
                        meta.key,
                        profiles[0]?.id || 'default'
                      );
                      if (profId !== 'off') {
                        activePipeline.push({
                          meta,
                          profileId: profId,
                          profiles,
                          currentProfile: profiles.find((p) => p.id === profId),
                        });
                      }
                    }
                  }

                  return (
                    <div
                      key={route.id}
                      onClick={() => setSelectedRouteId(route.id)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                        if (dragOverRouteId !== route.id) {
                          setDragOverRouteId(route.id);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverRouteId === route.id) {
                          setDragOverRouteId(null);
                        }
                      }}
                      onDrop={(e) => void handleDropOnRoute(e, route)}
                      className={`group relative flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                        isDragOver
                          ? 'border-emerald-500 bg-emerald-500/10 shadow-lg scale-[1.01]'
                          : isSelected
                          ? 'border-primary bg-card shadow-md ring-4 ring-primary/10'
                          : 'border-border/80 bg-card/85 hover:border-primary/40 hover:bg-card'
                      } ${!route.enabled ? 'opacity-65' : ''}`}
                    >
                      {/* Horizontal Connector Branch from Host Tree */}
                      <div className="hidden md:block absolute -left-6 top-1/2 w-6 h-0.5 bg-primary/25" />

                      {/* 1. ROUTE IDENTITY & PIPELINE ZONE */}
                      <div className="flex-1 min-w-0 space-y-3">
                        {/* Route Top Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="px-2.5 py-1 rounded-lg bg-primary/15 text-primary font-mono text-xs font-bold border border-primary/30">
                              {route.path}
                            </span>
                            <span className="font-semibold text-sm text-foreground truncate">
                              {route.name}
                            </span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Prio {route.priority}
                            </span>
                            {route.strip_path && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                strip_path
                              </span>
                            )}
                            {route.websocket && (
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                                WS
                              </span>
                            )}
                          </div>

                          {/* Route Node Quick Actions */}
                          <div
                            className="flex items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isSaving && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Syncing SHM...
                              </span>
                            )}
                            {activePipeline.length > 0 && (
                              <button
                                type="button"
                                onClick={() => void setRoutePassthrough(route)}
                                title="Gỡ toàn bộ Extension trên Route này (Raw Passthrough 0 FFI)"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-border/60 transition-colors cursor-pointer"
                              >
                                <Ban className="w-3 h-3" />
                                <span>Clear All</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onEditRoute(route)}
                              title="Chỉnh sửa thông tin Route"
                              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleRoute(route, !route.enabled)}
                              title={route.enabled ? 'Đang bật (Click để tắt)' : 'Đang tắt (Click để bật)'}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold cursor-pointer transition-colors ${
                                route.enabled
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-muted text-muted-foreground'
                              }`}
                            >
                              {route.enabled ? 'ACTIVE' : 'DISABLED'}
                            </button>
                          </div>
                        </div>

                        {/* EXECUTION PIPELINE CHIPS */}
                        <div className="p-3 rounded-xl bg-background/70 border border-border/70">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                              Dataplane Execution Pipeline ({activePipeline.length} active extensions)
                            </span>
                            {isSelected && (
                              <span className="text-[10px] font-semibold text-primary flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                Đang chọn Route này — Bấm vào Profile bên phải để gắn nhanh
                              </span>
                            )}
                          </div>

                          {activePipeline.length === 0 ? (
                            <div className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                                <span>
                                  <strong>Raw Passthrough (0 FFI Overhead)</strong> — Đi thẳng tới Upstream không chạy Extension nào.
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-primary shrink-0">
                                Thả Profile vào đây +
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              {activePipeline.map((item, idx) => (
                                <React.Fragment key={item.meta.key}>
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 shadow-2xs"
                                  >
                                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold flex items-center justify-center">
                                      {idx + 1}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-bold text-foreground">
                                          {item.meta.shortLabel}
                                        </span>
                                        <span className="text-muted-foreground text-[10px]">:</span>
                                        <select
                                          value={item.profileId}
                                          onChange={(e) =>
                                            void assignProfileToRoute(
                                              route,
                                              item.meta.key,
                                              e.target.value
                                            )
                                          }
                                          className="bg-background/90 border border-emerald-500/30 rounded-md px-1.5 py-0.5 text-[11px] font-mono font-semibold text-emerald-300 focus:outline-hidden cursor-pointer"
                                        >
                                          {item.profiles.map((prof) => (
                                            <option key={prof.id} value={prof.id}>
                                              {prof.id} ({prof.label})
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      {item.currentProfile && (
                                        <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[210px]">
                                          {item.currentProfile.summary}
                                        </div>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void assignProfileToRoute(route, item.meta.key, 'off')
                                      }
                                      title={`Gỡ ${item.meta.label} khỏi Route ${route.path}`}
                                      className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/15 transition-colors cursor-pointer"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  {idx < activePipeline.length - 1 && (
                                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                                  )}
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 2. CONNECTOR ARROW TO UPSTREAM */}
                      <div className="hidden lg:flex items-center justify-center px-1 text-muted-foreground">
                        <ArrowRight className="w-5 h-5 text-primary/60" />
                      </div>

                      {/* 3. TARGET UPSTREAM NODE */}
                      <div className="lg:w-48 shrink-0 flex flex-col justify-center p-3 rounded-xl border border-border bg-muted/25">
                        <span className="text-[10px] font-mono uppercase text-muted-foreground">
                          Target Upstream
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          <Layers className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-mono text-xs font-bold text-foreground truncate">
                            {route.upstream_name}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT: EXTENSION PROFILES DOCK (4 cols, sticky) */}
      <div className="xl:col-span-4 xl:sticky xl:top-6 rounded-2xl border border-border/80 bg-card/85 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border/70 bg-muted/20 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-primary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Extension Profiles Dock
              </h3>
            </div>
            <Link
              to="/extensions"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <span>Tạo / Sửa Profile</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {selectedRoute ? (
              <>
                Đang chọn Route{' '}
                <code className="px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono font-bold">
                  {selectedRoute.path}
                </code>
                . Bấm vào bất kỳ Profile nào dưới đây (hoặc kéo thả vào Route) để gán ngay.
              </>
            ) : (
              'Hãy bấm chọn 1 Route bên trái hoặc kéo thả Profile vào Route trên Canvas.'
            )}
          </p>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-1.5 pt-1">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'performance', label: 'Cache & Nén', icon: Zap },
                { id: 'traffic', label: 'Rate & Conn', icon: Gauge },
                { id: 'security', label: 'Bảo mật', icon: Shield },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDockCategory(tab.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                  dockCategory === tab.id
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'bg-background/70 text-muted-foreground hover:text-foreground border border-border/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable List of Extensions & Their Profiles */}
        <div className="p-4 space-y-4 max-h-[72vh] overflow-y-auto">
          {filteredCatalog.map((ext) => {
            const profiles = resolveExtensionProfiles(ext.key, liveConfigsByExt[ext.key]);
            const selectedRouteObj = selectedRoute
              ? parsePluginsObj(selectedRoute.plugins_json)
              : {};
            const activeProfOnSelected =
              selectedRoute &&
              selectedRouteObj._profile !== 'passthrough' &&
              selectedRouteObj._profile !== 'raw'
                ? getRouteExtensionSelectedProfile(
                    selectedRouteObj,
                    ext.key,
                    profiles[0]?.id || 'default'
                  )
                : 'off';

            return (
              <div
                key={ext.key}
                className="rounded-xl border border-border/80 bg-background/50 p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-foreground">{ext.label}</h4>
                    <p className="text-[10px] text-muted-foreground">{ext.description}</p>
                  </div>
                  {activeProfOnSelected !== 'off' && (
                    <button
                      type="button"
                      onClick={() =>
                        selectedRoute &&
                        void assignProfileToRoute(selectedRoute, ext.key, 'off')
                      }
                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-pointer shrink-0"
                    >
                      Gỡ (Off)
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-1.5">
                  {profiles.map((prof) => {
                    const isAssigned = activeProfOnSelected === prof.id;
                    return (
                      <div
                        key={prof.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, ext.key, prof.id)}
                        onClick={() => {
                          if (!selectedRoute) return;
                          const nextProf = isAssigned ? 'off' : prof.id;
                          void assignProfileToRoute(selectedRoute, ext.key, nextProf);
                        }}
                        className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border transition-all cursor-pointer select-none ${
                          isAssigned
                            ? 'border-emerald-500 bg-emerald-500/15 text-foreground shadow-2xs'
                            : 'border-border/70 bg-card hover:border-primary/50 hover:bg-primary/5'
                        }`}
                      >
                        <div className="flex items-start gap-2 min-w-0">
                          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/60 mt-0.5 shrink-0 cursor-grab" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[11px] font-bold text-primary">
                                [{prof.id}]
                              </span>
                              <span className="text-xs font-semibold text-foreground truncate">
                                {prof.label}
                              </span>
                              {!prof.builtin && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-400 font-mono">
                                  Custom
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {prof.summary}
                            </p>
                          </div>
                        </div>

                        <div className="shrink-0">
                          {isAssigned ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500 text-white text-[10px] font-mono font-bold">
                              <CheckCircle2 className="w-3 h-3" />
                              Đang gắn
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-muted-foreground hover:text-foreground text-[10px] font-mono">
                              <Plus className="w-3 h-3" />
                              Gán
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
