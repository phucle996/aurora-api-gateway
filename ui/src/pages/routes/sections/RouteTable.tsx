import React from 'react';
import { Route, Pencil, Trash2, ArrowRightLeft, Zap, Layers, Sparkles } from 'lucide-react';
import type { RouteItem } from '../types';

interface RouteTableProps {
  routes: RouteItem[];
  onEdit: (route: RouteItem) => void;
  onDelete: (route: RouteItem) => void;
  onToggle: (route: RouteItem, enabled: boolean) => void;
  togglingIds: Record<string, boolean>;
}

export function RouteTable({
  routes,
  onEdit,
  onDelete,
  onToggle,
  togglingIds,
}: RouteTableProps) {
  if (routes.length === 0) {
    return (
      <div className="bg-card/70 border border-border/70 rounded-xl p-12 text-center">
        <div className="mx-auto w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
          <Route className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">No routes found</h3>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          No routing rules match your search or filter criteria. Create a new route to direct traffic to your upstreams.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card/80 border border-border/80 rounded-xl overflow-hidden shadow-xs backdrop-blur-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 border-b border-border/70 text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4 w-4/12">Route Name</th>
              <th className="py-3 px-4 w-3/12">Host & Path Prefix</th>
              <th className="py-3 px-4 w-2/12">Target Upstream</th>
              <th className="py-3 px-4 w-2/12">Capabilities & Priority</th>
              <th className="py-3 px-4 w-1/12 text-center">Status</th>
              <th className="py-3 px-4 w-1/12 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {routes.map((route) => {
              const isToggling = Boolean(togglingIds[route.id]);

              return (
                <tr
                  key={route.id}
                  className={`group hover:bg-muted/30 transition-colors duration-150 ${
                    !route.enabled ? 'opacity-70 hover:opacity-100' : ''
                  }`}
                >
                  {/* Name & ID */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 transition-transform duration-200 group-hover:scale-105">
                        <Route className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground truncate">
                            {route.name}
                          </span>
                          <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm shrink-0">
                            {route.id}
                          </span>
                        </div>
                        {route.description ? (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5 max-w-xs">
                            {route.description}
                          </p>
                        ) : (
                          <p className="text-[11px] text-muted-foreground/60 font-mono truncate mt-0.5">
                            Created {new Date(route.created_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Host & Path */}
                  <td className="py-3.5 px-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground uppercase font-mono">Host:</span>
                        <span className="font-mono text-xs text-foreground font-medium bg-muted/60 px-1.5 py-0.5 rounded-sm">
                          {route.host}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground uppercase font-mono">Path:</span>
                        <span className="font-mono text-xs text-primary font-semibold bg-primary/10 px-1.5 py-0.5 rounded-sm">
                          {route.path}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* Upstream */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="font-mono text-xs text-foreground font-medium bg-muted/60 px-2 py-0.5 rounded-md">
                        {route.upstream_name}
                      </span>
                    </div>
                  </td>

                  {/* Capabilities & Priority */}
                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-sm border border-border">
                        Priority: {route.priority}
                      </span>
                      {route.websocket && (
                        <span className="flex items-center gap-1 font-mono text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20 px-1.5 py-0.5 rounded-sm">
                          <Zap className="w-2.5 h-2.5" /> WS
                        </span>
                      )}
                      {route.strip_path && (
                        <span className="flex items-center gap-1 font-mono text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-sm">
                          <ArrowRightLeft className="w-2.5 h-2.5" /> Strip
                        </span>
                      )}
                      {route.plugins_json && route.plugins_json !== '{}' && (
                        <span className="flex items-center gap-1 font-mono text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded-sm">
                          <Sparkles className="w-2.5 h-2.5" /> Plugins
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Status Toggle */}
                  <td className="py-3.5 px-4 text-center">
                    <button
                      type="button"
                      disabled={isToggling}
                      onClick={() => onToggle(route, !route.enabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                        route.enabled ? 'bg-emerald-500' : 'bg-muted'
                      } ${isToggling ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          route.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(route)}
                        title="Edit Route"
                        className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/70 rounded-lg transition-colors cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(route)}
                        title="Delete Route"
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
