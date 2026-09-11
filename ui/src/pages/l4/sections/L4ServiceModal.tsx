import React, { useState, useEffect } from 'react';
import { Network, Server, ArrowRight, Shield, X, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { L4ServiceItem, L4ACLRule, CreateL4ServicePayload } from '../../../lib/api/l4';
import type { UpstreamItem } from '../../upstreams/types';

interface L4ServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  service: L4ServiceItem | null;
  availableUpstreams: UpstreamItem[];
  onSave: (payload: CreateL4ServicePayload) => Promise<void>;
}

export function L4ServiceModal({
  isOpen,
  onClose,
  service,
  availableUpstreams,
  onSave,
}: L4ServiceModalProps) {
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState('tcp');
  const [port, setPort] = useState<number>(5432);
  const [targetType, setTargetType] = useState<'upstream' | 'endpoint'>('upstream');
  const [upstream, setUpstream] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [proxyTimeout, setProxyTimeout] = useState('1h');
  const [connectTimeout, setConnectTimeout] = useState('5s');
  const [enabled, setEnabled] = useState(true);
  const [description, setDescription] = useState('');
  const [acl, setAcl] = useState<L4ACLRule[]>([]);
  const [newCidr, setNewCidr] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (service) {
      setName(service.name);
      setProtocol(service.protocol);
      setPort(service.listen_port);
      setTargetType(
        service.forward_target_type || (service.direct_endpoint ? 'endpoint' : 'upstream')
      );
      setUpstream(service.upstream_name || '');
      setEndpoint(service.direct_endpoint || '');
      setProxyTimeout(service.proxy_timeout || '1h');
      setConnectTimeout(service.proxy_connect_timeout || '5s');
      setEnabled(service.enabled);
      setDescription(service.description || '');
      try {
        setAcl(JSON.parse(service.acl_rules_json || '[]'));
      } catch {
        setAcl([]);
      }
    } else {
      setName('');
      setProtocol('tcp');
      setPort(5432);
      setTargetType('upstream');
      setUpstream(availableUpstreams[0]?.name || '');
      setEndpoint('');
      setProxyTimeout('1h');
      setConnectTimeout('5s');
      setEnabled(true);
      setDescription('');
      setAcl([]);
    }
  }, [service, availableUpstreams]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        protocol,
        listen_port: Number(port),
        forward_target_type: targetType,
        upstream_name: targetType === 'upstream' ? upstream.trim() : '',
        direct_endpoint: targetType === 'endpoint' ? endpoint.trim() : '',
        acl_rules_json: JSON.stringify(acl),
        proxy_timeout: proxyTimeout,
        proxy_connect_timeout: connectTimeout,
        enabled,
        description,
      });
      onClose();
    } catch (err: any) {
      alert(err?.message || 'Failed to save service');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddACL = () => {
    if (!newCidr.trim()) return;
    setAcl([...acl, { cidr: newCidr.trim(), action: newAction }]);
    setNewCidr('');
  };

  const handleRemoveACL = (idx: number) => {
    setAcl(acl.filter((_, i) => i !== idx));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-card border border-border/60 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-cyan-400" />
            <h3 className="font-semibold text-lg text-foreground">
              {service ? 'Edit L4 Stream Service' : 'New L4 Stream Service'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Service Name *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. postgres_edge"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Protocol *
              </label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              >
                <option value="tcp">TCP (Reliable stream: DB, SSH, Redis)</option>
                <option value="udp">UDP (Datagram: DNS, Game, Syslog)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1.5">
              Listen Port (1 - 65535) *
            </label>
            <input
              type="number"
              required
              min={1}
              max={65535}
              value={port}
              onChange={(e) => setPort(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
            />
          </div>

          {/* Forward Target Type Toggle */}
          <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-3">
            <label className="block text-xs font-semibold text-foreground">
              Forward Destination *
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetType('upstream')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium border transition-all ${
                  targetType === 'upstream'
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40 shadow-sm'
                    : 'bg-background/40 text-muted-foreground border-border/40 hover:bg-muted/40'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                Upstream Pool
              </button>

              <button
                type="button"
                onClick={() => setTargetType('endpoint')}
                className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium border transition-all ${
                  targetType === 'endpoint'
                    ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40 shadow-sm'
                    : 'bg-background/40 text-muted-foreground border-border/40 hover:bg-muted/40'
                }`}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                Direct IP / Endpoint
              </button>
            </div>

            {targetType === 'upstream' ? (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Select Upstream Pool:
                </label>
                {availableUpstreams.length === 0 ? (
                  <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs flex items-center justify-between">
                    <span>No upstreams configured yet.</span>
                    <Link
                      to="/upstreams"
                      target="_blank"
                      className="inline-flex items-center gap-1 font-semibold underline hover:text-amber-300"
                    >
                      Create Upstream <ExternalLink className="w-3 h-3" />
                    </Link>
                  </div>
                ) : (
                  <select
                    value={upstream}
                    onChange={(e) => setUpstream(e.target.value)}
                    required={targetType === 'upstream'}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                  >
                    {availableUpstreams.map((up) => (
                      <option key={up.name} value={up.name}>
                        {up.name} ({up.algorithm || 'round_robin'}, {up.servers?.length || 0} nodes)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Direct Target Address (IP:Port or Host:Port):
                </label>
                <input
                  type="text"
                  required={targetType === 'endpoint'}
                  placeholder="e.g. 10.0.0.15:5432 or db.internal:5432"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Forwards raw stream directly to this server without requiring a pool.
                </p>
              </div>
            )}
          </div>

          {/* ACL Rules Section */}
          <div className="space-y-2 pt-2 border-t border-border/40">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-cyan-400" />
                Layer 4 Access Control (CIDR Allow / Deny)
              </label>
              <span className="text-[11px] text-muted-foreground">Evaluated in order</span>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. 192.168.1.0/24 or 10.0.0.5"
                value={newCidr}
                onChange={(e) => setNewCidr(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
              <select
                value={newAction}
                onChange={(e) => setNewAction(e.target.value as 'allow' | 'deny')}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-border/60 bg-background/50 text-foreground focus:outline-none"
              >
                <option value="allow">ALLOW</option>
                <option value="deny">DENY</option>
              </select>
              <button
                type="button"
                onClick={handleAddACL}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-sm"
              >
                Add Rule
              </button>
            </div>

            {acl.length > 0 && (
              <div className="space-y-1.5 mt-2 max-h-32 overflow-y-auto">
                {acl.map((r, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-border/40 bg-muted/20 text-xs font-mono"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                          r.action === 'allow'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-rose-500/20 text-rose-400'
                        }`}
                      >
                        {r.action}
                      </span>
                      <span className="text-foreground">{r.cidr}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveACL(idx)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advanced Timeouts */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/40">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Proxy Timeout
              </label>
              <input
                type="text"
                placeholder="1h, 30m, 60s"
                value={proxyTimeout}
                onChange={(e) => setProxyTimeout(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Connect Timeout
              </label>
              <input
                type="text"
                placeholder="5s, 10s"
                value={connectTimeout}
                onChange={(e) => setConnectTimeout(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-foreground mb-1">
              Description
            </label>
            <textarea
              rows={2}
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-border/60 bg-background/50 text-foreground focus:ring-1 focus:ring-cyan-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="modalSvcEnabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded border-border/60 text-cyan-500 focus:ring-cyan-400"
            />
            <label htmlFor="modalSvcEnabled" className="text-xs text-foreground font-medium">
              Enable listener upon saving
            </label>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/50">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/40 text-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-sm disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : service ? 'Save Changes' : 'Create Service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
