import React from 'react';
import {
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Trash2,
  Pencil,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { L4ServiceItem, L4ACLRule } from '../../../lib/api/l4';

interface L4ServiceTableProps {
  services: L4ServiceItem[];
  loading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  protoFilter: 'all' | 'tcp' | 'udp';
  onProtoFilterChange: (p: 'all' | 'tcp' | 'udp') => void;
  selectedStatFilter: string | null;
  onClearFilters: () => void;
  onEdit: (service: L4ServiceItem) => void;
  onDelete: (service: L4ServiceItem) => void;
  onToggleStatus: (service: L4ServiceItem) => void;
  onCreateNew: () => void;
}

export function L4ServiceTable({
  services,
  loading,
  searchQuery,
  onSearchChange,
  protoFilter,
  onProtoFilterChange,
  selectedStatFilter,
  onClearFilters,
  onEdit,
  onDelete,
  onToggleStatus,
  onCreateNew,
}: L4ServiceTableProps) {
  return (
    <div className="space-y-4">
      {/* Controls Bar: Search & Protocol Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/50 border border-border/60 p-3 rounded-xl backdrop-blur-xs">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search by name, port, target, upstream..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-background/80 border border-border/80 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary text-foreground placeholder:text-muted-foreground font-sans"
          />
        </div>

        {/* Protocol Segmented Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center bg-muted/60 p-0.5 rounded-lg border border-border/60">
            {(['all', 'tcp', 'udp'] as const).map((proto) => (
              <button
                key={proto}
                type="button"
                onClick={() => onProtoFilterChange(proto)}
                className={`px-3 py-1 text-xs font-mono uppercase tracking-wider rounded-md transition-all cursor-pointer ${
                  protoFilter === proto
                    ? 'bg-card text-foreground font-semibold shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {proto}
              </button>
            ))}
          </div>

          {(searchQuery || protoFilter !== 'all' || selectedStatFilter) && (
            <button
              type="button"
              onClick={onClearFilters}
              className="px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-lg transition-colors cursor-pointer"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Services Table or Empty State */}
      {loading ? (
        <div className="bg-card/80 border border-border/80 rounded-xl p-12 text-center shadow-xs backdrop-blur-xs">
          <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground font-medium">Loading L4 stream services...</p>
        </div>
      ) : services.length === 0 ? (
        <div className="bg-card/70 border border-border/70 rounded-xl p-12 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-3">
            <Network className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">No L4 Services found</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {searchQuery || protoFilter !== 'all' || selectedStatFilter
              ? 'No Layer 4 stream services match your search or filter criteria.'
              : 'Create your first L4 TCP/UDP service to proxy raw transport traffic with CIDR access control.'}
          </p>
          <button
            type="button"
            onClick={onCreateNew}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-xl shadow-xs transition-colors cursor-pointer mt-4"
          >
            <Plus className="w-4 h-4" />
            <span>Add L4 Service</span>
          </button>
        </div>
      ) : (
        <div className="bg-card/80 border border-border/80 rounded-xl overflow-hidden shadow-xs backdrop-blur-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b border-border/70 text-muted-foreground uppercase font-mono text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4 w-4/12">Service Name</th>
                  <th className="py-3 px-4 w-2/12">Protocol & Port</th>
                  <th className="py-3 px-4 w-3/12">Forward Target</th>
                  <th className="py-3 px-4 w-2/12">Security & Timeouts</th>
                  <th className="py-3 px-4 w-1/12 text-center">Status</th>
                  <th className="py-3 px-4 w-1/12 text-right pr-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {services.map((svc) => {
                  let acls: L4ACLRule[] = [];
                  try {
                    acls = JSON.parse(svc.acl_rules_json || '[]');
                  } catch {
                    acls = [];
                  }
                  const isEndpoint =
                    svc.forward_target_type === 'endpoint' ||
                    (!svc.upstream_name && Boolean(svc.direct_endpoint));

                  return (
                    <tr
                      key={svc.id}
                      className={`group hover:bg-muted/30 transition-colors duration-150 ${
                        !svc.enabled ? 'opacity-70 hover:opacity-100' : ''
                      }`}
                    >
                      {/* Name & ID */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 transition-transform duration-200 group-hover:scale-105">
                            <Network className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground truncate">
                                {svc.name}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-sm shrink-0">
                                {svc.id}
                              </span>
                            </div>
                            {svc.description ? (
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5 max-w-xs">
                                {svc.description}
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground/60 font-mono truncate mt-0.5">
                                Created {new Date(svc.created_at).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Protocol & Port */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-md bg-muted/60 border border-border/60 text-foreground">
                          <span className="font-bold text-primary uppercase">
                            {svc.protocol}
                          </span>
                          <span className="text-muted-foreground">:</span>
                          <span className="font-semibold">{svc.listen_port}</span>
                        </div>
                      </td>

                      {/* Forward Target */}
                      <td className="py-3.5 px-4">
                        {isEndpoint ? (
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-md bg-sky-500/10 border border-sky-500/20 text-sky-400">
                            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-semibold">Direct:</span>
                            <span>{svc.direct_endpoint}</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-md bg-primary/10 border border-primary/20 text-primary">
                            <Server className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-semibold">Pool:</span>
                            <span>{svc.upstream_name}</span>
                          </div>
                        )}
                      </td>

                      {/* Security & Timeouts */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1">
                          {acls.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground font-mono">All Allowed</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20">
                                <Shield className="w-3 h-3" />
                                {acls.length} {acls.length === 1 ? 'Rule' : 'Rules'}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                            <Clock className="w-3 h-3 text-muted-foreground/70" />
                            <span>{svc.proxy_timeout || '1h'}</span>
                            <span className="text-muted-foreground/40">/</span>
                            <span>{svc.proxy_connect_timeout || '5s'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Status Toggle */}
                      <td className="py-3.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => onToggleStatus(svc)}
                          className="inline-flex items-center gap-1 cursor-pointer focus:outline-hidden"
                          title={svc.enabled ? 'Click to disable' : 'Click to enable'}
                        >
                          {svc.enabled ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full border border-border/60">
                              <XCircle className="w-3 h-3" /> Inactive
                            </span>
                          )}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right pr-4">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onEdit(svc)}
                            className="p-1.5 rounded-lg hover:bg-muted/70 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                            title="Edit Service"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(svc)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                            title="Delete Service"
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
      )}
    </div>
  );
}

