import React from 'react';
import {
  Network,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  Trash2,
  Edit2,
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
  onEdit,
  onDelete,
  onToggleStatus,
  onCreateNew,
}: L4ServiceTableProps) {
  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-border/50 bg-card/30">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search port, name, target..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border/60 bg-background/50 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition-all text-foreground"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          <span className="text-xs text-muted-foreground">Protocol:</span>
          {(['all', 'tcp', 'udp'] as const).map((proto) => (
            <button
              key={proto}
              onClick={() => onProtoFilterChange(proto)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium uppercase tracking-wider transition-colors ${
                protoFilter === proto
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'text-muted-foreground hover:bg-muted/40'
              }`}
            >
              {proto}
            </button>
          ))}
        </div>
      </div>

      {/* Services Table */}
      <div className="rounded-xl border border-border/50 bg-card/40 overflow-hidden shadow-sm">
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
            <p className="text-sm">Loading L4 Services...</p>
          </div>
        ) : services.length === 0 ? (
          <div className="py-16 text-center">
            <Network className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <h3 className="text-base font-semibold text-foreground">No L4 Services found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Create your first L4 TCP/UDP service to proxy raw transport traffic with CIDR access control.
            </p>
            <button
              onClick={onCreateNew}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Create L4 Service
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border/50 bg-muted/20 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Service Name</th>
                  <th className="py-3 px-4">Listener</th>
                  <th className="py-3 px-4">Forward Target</th>
                  <th className="py-3 px-4">ACL Rules</th>
                  <th className="py-3 px-4">Timeouts</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-sm">
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
                    <tr key={svc.id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => onToggleStatus(svc)}
                          className="flex items-center gap-1.5 focus:outline-none"
                          title={svc.enabled ? 'Click to disable' : 'Click to enable'}
                        >
                          {svc.enabled ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                              <CheckCircle2 className="w-3 h-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full border border-border/40">
                              <XCircle className="w-3 h-3" /> Inactive
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-foreground">{svc.name}</div>
                        {svc.description && (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {svc.description}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-md bg-muted/40 border border-border/60 text-foreground">
                          <span className="font-bold text-cyan-400 uppercase">
                            {svc.protocol}
                          </span>
                          <span className="text-muted-foreground">:</span>
                          <span>{svc.listen_port}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {isEndpoint ? (
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-md bg-sky-500/10 border border-sky-500/20 text-sky-400">
                            <ArrowRight className="w-3 h-3 shrink-0" />
                            <span className="font-semibold">Direct:</span>
                            <span>{svc.direct_endpoint}</span>
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                            <Server className="w-3 h-3 shrink-0" />
                            <span className="font-semibold">Pool:</span>
                            <span>{svc.upstream_name}</span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        {acls.length === 0 ? (
                          <span className="text-xs text-muted-foreground">All allowed</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                              <Shield className="w-3 h-3" />
                              {acls.length} {acls.length === 1 ? 'Rule' : 'Rules'}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                          <Clock className="w-3 h-3" />
                          <span>{svc.proxy_timeout || '1h'}</span>
                          <span className="text-muted-foreground/40">/</span>
                          <span>{svc.proxy_connect_timeout || '5s'}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onEdit(svc)}
                            className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
                            title="Edit Service"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => onDelete(svc)}
                            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            title="Delete Service"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
