import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Network,
  Server,
  ArrowRight,
  ArrowRightLeft,
  FastForward,
  Shield,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Code,
  Zap,
  Save,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Info,
} from 'lucide-react';
import { l4Api, L4ACLRule } from '../../../lib/api/l4';
import { upstreamsApi } from '../../../lib/api/upstreams';
import type { UpstreamItem } from '../../upstreams/types';
import type { L4TrafficAction } from '../create/page';

export default function EditL4ServicePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  // Basic Info
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<'tcp' | 'udp'>('tcp');
  const [port, setPort] = useState<number>(5432);
  const [enabled, setEnabled] = useState(true);
  const [description, setDescription] = useState('');

  // 2 Primary Options: 'continue' | 'forward'
  const [trafficAction, setTrafficAction] = useState<L4TrafficAction>('continue');

  // Forward details
  const [targetType, setTargetType] = useState<'upstream' | 'endpoint'>('upstream');
  const [upstream, setUpstream] = useState('');
  const [endpoint, setEndpoint] = useState('');

  // Upstreams list
  const [availableUpstreams, setAvailableUpstreams] = useState<UpstreamItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ACL Rules with Priority
  const [aclRules, setAclRules] = useState<L4ACLRule[]>([]);
  const [newPriority, setNewPriority] = useState<number>(1);
  const [newCidr, setNewCidr] = useState('');
  const [newAction, setNewAction] = useState<'allow' | 'deny'>('allow');
  const [newDescription, setNewDescription] = useState('');

  // Timeouts
  const [proxyTimeout, setProxyTimeout] = useState('1h');
  const [connectTimeout, setConnectTimeout] = useState('5s');

  // Status
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (protocol === 'udp' && trafficAction === 'continue') {
      setTrafficAction('forward');
    }
  }, [protocol, trafficAction]);

  // Fetch service details and upstreams
  useEffect(() => {
    if (!id) return;
    let mounted = true;

    Promise.all([
      l4Api.getService(id),
      upstreamsApi.list({ limit: 100 }).catch(() => ({ items: [] as UpstreamItem[] })),
    ])
      .then(([svc, upRes]) => {
        if (!mounted) return;
        setAvailableUpstreams(upRes.items || []);

        setName(svc.name);
        setProtocol(svc.protocol.toLowerCase() === 'udp' ? 'udp' : 'tcp');
        setPort(svc.listen_port);
        setEnabled(svc.enabled);
        setDescription(svc.description || '');
        setProxyTimeout(svc.proxy_timeout || '1h');
        setConnectTimeout(svc.proxy_connect_timeout || '5s');

        // Controller persists ACLs in descending priority order.
        let parsedAcl: L4ACLRule[] = [];
        try {
          parsedAcl = JSON.parse(svc.acl_rules_json || '[]');
        } catch {
          parsedAcl = [];
        }
        const normalizedAcl = parsedAcl.sort((a, b) => b.priority - a.priority);
        setAclRules(normalizedAcl);

        // Detect action strategy
        if (svc.direct_endpoint === '127.0.0.1:80') {
          setTrafficAction('continue');
        } else {
          setTrafficAction('forward');
          if (svc.forward_target_type === 'endpoint' || (!svc.upstream_name && svc.direct_endpoint)) {
            setTargetType('endpoint');
            setEndpoint(svc.direct_endpoint || '');
          } else {
            setTargetType('upstream');
            setUpstream(svc.upstream_name || '');
          }
        }
      })
      .catch((err) => {
        if (mounted) setErrorMsg(err?.message || 'Failed to load L4 service details');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  // Update default new priority based on existing rules
  useEffect(() => {
    if (aclRules.length === 0) {
      setNewPriority(1);
    } else {
      const maxP = Math.max(...aclRules.map((r) => r.priority));
      setNewPriority(maxP + 1);
    }
  }, [aclRules]);

  const handleAddACL = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newCidr.trim()) return;

    const priority = Number(newPriority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 1_000_000) {
      setErrorMsg('Priority must be an integer between 1 and 1,000,000.');
      return;
    }
    if (aclRules.some((rule) => rule.priority === priority)) {
      setErrorMsg(`Priority ${priority} is already in use.`);
      return;
    }

    const ruleToAdd: L4ACLRule = {
      priority,
      cidr: newCidr.trim(),
      action: newAction,
      description: newDescription.trim() || undefined,
    };

    setAclRules((prev) => {
      const updated = [...prev, ruleToAdd];
      return updated.sort((a, b) => b.priority - a.priority);
    });

    setNewCidr('');
    setNewDescription('');
  };

  const handleQuickAddRule = (cidr: string, action: 'allow' | 'deny', desc: string) => {
    setAclRules((prev) => {
      if (action === 'deny' && cidr === '0.0.0.0/0') {
        const shifted = prev.map((rule) => ({ ...rule, priority: rule.priority + 1 }));
        return [...shifted, { priority: 1, cidr, action, description: desc }].sort(
          (a, b) => b.priority - a.priority
        );
      }
      const nextP = prev.length === 0 ? 1 : Math.max(...prev.map((rule) => rule.priority)) + 1;
      const updated = [
        ...prev,
        {
          priority: nextP,
          cidr,
          action,
          description: desc,
        },
      ];
      return updated.sort((a, b) => b.priority - a.priority);
    });
  };

  const handleRemoveACL = (index: number) => {
    setAclRules((prev) => {
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleMoveRule = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === aclRules.length - 1)
    ) {
      return;
    }
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    setAclRules((prev) => {
      const updated = [...prev];
      const current = updated[index];
      const adjacent = updated[targetIdx];
      updated[index] = { ...current, priority: adjacent.priority };
      updated[targetIdx] = { ...adjacent, priority: current.priority };
      return updated.sort((a, b) => b.priority - a.priority);
    });
  };

  // Compile preview of NGINX stream block
  const nginxPreview = useMemo(() => {
    const lines: string[] = [];
    lines.push('server {');
    const udpOpt = protocol === 'udp' ? ' udp' : '';
    lines.push(`    listen ${port || 0}${udpOpt};`);

    // NGINX evaluates the first matching rule, so larger priorities render first.
    if (aclRules.length > 0) {
      lines.push('    # Access Control List (Evaluated sequentially: first match wins)');
      const sorted = [...aclRules].sort((a, b) => b.priority - a.priority);
      for (const r of sorted) {
        const comment = r.description ? ` # Priority ${r.priority}: ${r.description}` : ` # Priority ${r.priority}`;
        lines.push(`    ${r.action} ${r.cidr};${comment}`);
      }
    }

    if (trafficAction === 'continue') {
      lines.push('    # Action: CONTINUE -> Forward to the Layer 7 HTTP bridge');
      lines.push('    # Route match -> process; No route match -> NGINX 404 error');
      lines.push('    proxy_protocol on;');
      lines.push('    proxy_pass 127.0.0.1:9082;');
    } else {
      // Forward to
      if (targetType === 'endpoint') {
        lines.push(`    proxy_pass ${endpoint || '127.0.0.1:0'};`);
      } else {
        lines.push(`    proxy_pass l4_${upstream || 'upstream_pool'};`);
      }
    }

    if (proxyTimeout) {
      lines.push(`    proxy_timeout ${proxyTimeout};`);
    }
    if (connectTimeout) {
      lines.push(`    proxy_connect_timeout ${connectTimeout};`);
    }

    lines.push('}');
    return lines.join('\n');
  }, [protocol, port, trafficAction, aclRules, targetType, endpoint, upstream, proxyTimeout, connectTimeout]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setErrorMsg(null);

    if (!name.trim()) {
      setErrorMsg('Service Name is required.');
      return;
    }
    if (!port || port < 1 || port > 65535) {
      setErrorMsg('Listen Port must be between 1 and 65535.');
      return;
    }
    if (trafficAction === 'continue' && protocol !== 'tcp') {
      setErrorMsg('Continue is available only for clear-text TCP HTTP traffic.');
      return;
    }

    let targetTypeVal: 'upstream' | 'endpoint' = 'upstream';
    let upstreamVal = '';
    let endpointVal = '';

    if (trafficAction === 'forward') {
      targetTypeVal = targetType;
      if (targetType === 'upstream') {
        if (!upstream.trim()) {
          setErrorMsg('Please select an Upstream Pool.');
          return;
        }
        upstreamVal = upstream.trim();
      } else {
        if (!endpoint.trim()) {
          setErrorMsg('Please specify a Direct Target Address (IP:Port).');
          return;
        }
        endpointVal = endpoint.trim();
      }
    } else {
      // Continue mode -> L4 Pre-processing, pass internally to L7
      targetTypeVal = 'endpoint';
      endpointVal = '127.0.0.1:80';
      upstreamVal = '';
    }

    const sortedAcl = [...aclRules].sort((a, b) => b.priority - a.priority);

    setIsSubmitting(true);
    try {
      await l4Api.updateService(id, {
        name: name.trim(),
        protocol,
        listen_port: Number(port),
        forward_target_type: targetTypeVal,
        upstream_name: upstreamVal,
        direct_endpoint: endpointVal,
        acl_rules_json: JSON.stringify(sortedAcl),
        proxy_timeout: proxyTimeout.trim() || '1h',
        proxy_connect_timeout: connectTimeout.trim() || '5s',
        enabled,
        description: description.trim(),
      });

      navigate('/l4');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to update L4 service');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center space-y-3">
        <RefreshCw className="w-8 h-8 text-primary animate-spin" />
        <p className="text-xs text-muted-foreground font-medium">Loading L4 Service configuration...</p>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-6 pb-16 font-sans min-w-0">
      {/* Header & Back navigation */}
      <div className="flex flex-col gap-2">
        <Link
          to="/l4"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-fit cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to L4 Stream Gateway
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Network className="w-6 h-6" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">
                L4 Stream Gateway <span className="mx-1.5 text-border">/</span>{' '}
                <span className="text-foreground font-medium">{name || 'Service Details'}</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Edit L4 Stream Service
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Update transport listener settings, routing strategy, and priority-based CIDR rules.
              </p>
            </div>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl flex items-center gap-2 text-xs font-medium">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Main Form (8 Columns) */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            {/* Section 1: Service Identification & Port */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs backdrop-blur-xs">
              <div className="flex items-center gap-2 pb-3 border-b border-border/70">
                <Zap className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">
                  1. Listener & Service Identification
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Service Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Service name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary placeholder:text-muted-foreground"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Unique human-readable label for this transport proxy.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Transport Protocol <span className="text-destructive">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setProtocol('tcp')}
                      className={`flex items-center justify-center py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                        protocol === 'tcp'
                          ? 'bg-primary/10 text-primary border-primary/40 shadow-xs'
                          : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/40'
                      }`}
                    >
                      <span>TCP</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setProtocol('udp')}
                      className={`flex items-center justify-center py-2 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                        protocol === 'udp'
                          ? 'bg-primary/10 text-primary border-primary/40 shadow-xs'
                          : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/40'
                      }`}
                    >
                      <span>UDP</span>
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1.5">
                  Listen Port (1 - 65535) <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPort(val === '' ? 0 : parseInt(val, 10) || 0);
                  }}
                  placeholder="Port number"
                  className="w-full px-3 py-2 text-xs font-mono font-semibold bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Optional operational notes or network context..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 focus:border-primary placeholder:text-muted-foreground font-sans"
                />
              </div>
            </div>

            {/* Section 2: Traffic Action Strategy (2 Options: Continue / Forward To) */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs backdrop-blur-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border/70">
                <div className="flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">
                    2. Traffic Action Strategy
                  </h2>
                </div>
                <span className="text-[11px] text-muted-foreground font-medium">
                  Select routing strategy
                </span>
              </div>

              {/* 2 Prominent Option Cards: Continue & Forward To */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Option 1: Continue (L4 Pre-processing -> L7) */}
                <div
                  role="button"
                  tabIndex={protocol === 'udp' ? -1 : 0}
                  aria-disabled={protocol === 'udp'}
                  onClick={() => {
                    if (protocol === 'tcp') setTrafficAction('continue');
                  }}
                  onKeyDown={(e) => {
                    if (protocol === 'tcp' && (e.key === 'Enter' || e.key === ' ')) setTrafficAction('continue');
                  }}
                  className={`p-4 rounded-xl border transition-all text-left space-y-2 ${protocol === 'udp'
                    ? 'cursor-not-allowed opacity-55 border-border/70 bg-muted/20'
                    : 'cursor-pointer'
                  } ${
                    trafficAction === 'continue'
                      ? 'bg-violet-500/10 border-violet-500/50 ring-2 ring-violet-500/40 shadow-xs'
                      : 'bg-background/50 border-border/70 hover:border-violet-500/30 hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-2 rounded-lg bg-violet-500/15 text-violet-400">
                      <FastForward className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400">
                      Tiền xử lý L4
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Continue</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                      TCP HTTP không mã hoá được kiểm tra ACL ở L4, giữ IP nguồn qua PROXY protocol, rồi chuyển vào Route L7. UDP không hỗ trợ pipeline này.
                    </p>
                  </div>
                </div>

                {/* Option 2: Forward To */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setTrafficAction('forward')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setTrafficAction('forward');
                  }}
                  className={`p-4 rounded-xl border transition-all cursor-pointer text-left space-y-2 ${
                    trafficAction === 'forward'
                      ? 'bg-primary/10 border-primary/50 ring-2 ring-primary/40 shadow-xs'
                      : 'bg-background/50 border-border/70 hover:border-primary/30 hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-2 rounded-lg bg-primary/15 text-primary">
                      <ArrowRightLeft className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                      Standard Proxy
                    </span>
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Forward to</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                      Proxy incoming TCP/UDP connections to an upstream origin pool or direct server endpoint.
                    </p>
                  </div>
                </div>
              </div>

              {/* Sub-config depending on selected Action */}
              {trafficAction === 'continue' && (
                <div className="p-4 rounded-xl border border-violet-500/30 bg-violet-500/5 space-y-2.5 mt-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-violet-400 font-semibold text-xs">
                      <FastForward className="w-4 h-4" />
                      <span>Không cần cấu hình target (Tiền xử lý L4 → Chuyển tiếp lên L7)</span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/15 text-violet-400 font-semibold">
                      Auto L7 Pipeline
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Ở chế độ <strong>Continue</strong>, cổng TCP nhận HTTP không mã hoá, áp dụng ACL L4 theo thứ tự Priority và giữ IP nguồn khi chuyển vào pipeline Layer 7 để kiểm tra Route:
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-xs text-muted-foreground">
                    <li><strong>Khớp Route:</strong> NGINX kiểm tra chính sách WAF theo IP nguồn và chuyển tiếp vào Upstream của Route tương ứng.</li>
                    <li><strong>Không khớp Route:</strong> NGINX tự động phản hồi mã lỗi và đóng kết nối.</li>
                  </ul>
                </div>
              )}

              {trafficAction === 'forward' && (
                <div className="p-4 rounded-xl border border-border/70 bg-muted/20 space-y-3 mt-3">
                  <label className="block text-xs font-semibold text-foreground">
                    Forward Destination Target
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTargetType('upstream')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        targetType === 'upstream'
                          ? 'bg-primary/10 text-primary border-primary/40 shadow-xs'
                          : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/40'
                      }`}
                    >
                      <Server className="w-3.5 h-3.5" />
                      Upstream Origin Pool
                    </button>
                    <button
                      type="button"
                      onClick={() => setTargetType('endpoint')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                        targetType === 'endpoint'
                          ? 'bg-primary/10 text-primary border-primary/40 shadow-xs'
                          : 'bg-background/60 text-muted-foreground border-border/60 hover:bg-muted/40'
                      }`}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      Direct Endpoint (IP/FQDN)
                    </button>
                  </div>

                  {targetType === 'upstream' ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-medium text-foreground">
                          Target Upstream Pool:
                        </label>
                        <Link
                          to="/upstreams/create"
                          target="_blank"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        >
                          Create New Upstream <ExternalLink className="w-3 h-3" />
                        </Link>
                      </div>
                      {availableUpstreams.length === 0 ? (
                        <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-xs flex items-center justify-between">
                          <span>No upstream pools configured yet.</span>
                          <Link
                            to="/upstreams/create"
                            className="font-semibold underline hover:text-amber-400"
                          >
                            Add Upstream Pool
                          </Link>
                        </div>
                      ) : (
                        <select
                          value={upstream}
                          onChange={(e) => setUpstream(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 font-sans cursor-pointer"
                        >
                          {availableUpstreams.map((up) => (
                            <option key={up.name} value={up.name}>
                              {up.name} ({up.algorithm || 'round_robin'}, {up.servers?.length || 0} backends)
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1">
                        Direct Destination (IP:Port or FQDN:Port):
                      </label>
                      <input
                        type="text"
                        placeholder="IP:Port or host:port"
                        value={endpoint}
                        onChange={(e) => setEndpoint(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        NGINX stream directly forwards TCP/UDP traffic to this endpoint without pool balance.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section 3: Access Control List (CIDR Rules with Priority) */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs backdrop-blur-xs">
              <div className="flex items-center justify-between pb-3 border-b border-border/70">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold text-foreground">
                    3. Access Control List (CIDR Rules with Priority)
                  </h2>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {aclRules.length} {aclRules.length === 1 ? 'rule' : 'rules'} configured
                </span>
              </div>

              {/* Priority explanation banner */}
              <div className="p-3 rounded-lg border border-primary/20 bg-primary/5 text-xs text-muted-foreground flex items-start gap-2.5">
                <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  <span className="font-semibold text-foreground">Cơ chế đánh giá Priority:</span> Quy tắc được NGINX kiểm tra tuần tự theo thứ tự <strong>Priority giảm dần (số lớn hơn kiểm tra trước)</strong>. Khi một quy tắc khớp IP nguồn, NGINX áp dụng ngay kết quả (First-match wins) và dừng kiểm tra.
                  <div className="mt-1 text-[11px] text-muted-foreground/80">
                    💡 <em>Ví dụ Whitelist:</em> Priority 1: <strong className="text-destructive">DENY 0.0.0.0/0</strong>, Priority 100: <strong className="text-emerald-500">ALLOW 10.10.0.0/16</strong> (chỉ cho phép dải 10.10.x.x, toàn bộ IP khác bị chặn).
                  </div>
                </div>
              </div>

              {/* Add ACL Rule Row */}
              <div className="p-3.5 rounded-xl border border-border/70 bg-muted/20 space-y-3">
                <div className="text-xs font-semibold text-foreground">Add IP CIDR Rule</div>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-2">
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">
                      Priority
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={1000000}
                      value={newPriority}
                      onChange={(e) => setNewPriority(parseInt(e.target.value, 10) || 1)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-bold bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 text-center"
                      title="Larger priorities are evaluated first"
                    />
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">
                      CIDR Subnet
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 10.10.0.0/16 or 0.0.0.0/0"
                      value={newCidr}
                      onChange={(e) => setNewCidr(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs font-mono bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">
                      Action
                    </label>
                    <select
                      value={newAction}
                      onChange={(e) => setNewAction(e.target.value as 'allow' | 'deny')}
                      className="w-full px-2.5 py-1.5 text-xs bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 cursor-pointer"
                    >
                      <option value="allow">ALLOW (Cho phép)</option>
                      <option value="deny">DENY (Chặn kết nối)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 flex items-end">
                    <button
                      type="button"
                      onClick={handleAddACL}
                      className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg shadow-xs transition-colors cursor-pointer h-[32px]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add
                    </button>
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    placeholder="Optional description / note (e.g. Office Subnet, Admin VPN...)"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground"
                  />
                </div>

                {/* Quick Helper presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-muted-foreground font-medium mr-1">Quick Add:</span>
                  <button
                    type="button"
                    onClick={() => handleQuickAddRule('10.0.0.0/8', 'allow', 'Internal 10.0.0.0/8')}
                    className="px-2 py-0.5 text-[11px] font-mono rounded bg-background border border-border/70 hover:border-primary/50 text-foreground transition-colors cursor-pointer"
                  >
                    + Allow 10.0.0.0/8
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickAddRule('192.168.0.0/16', 'allow', 'Private LAN 192.168.0.0/16')}
                    className="px-2 py-0.5 text-[11px] font-mono rounded bg-background border border-border/70 hover:border-primary/50 text-foreground transition-colors cursor-pointer"
                  >
                    + Allow 192.168.0.0/16
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickAddRule('0.0.0.0/0', 'deny', 'Block all other IPs')}
                    className="px-2 py-0.5 text-[11px] font-mono rounded bg-destructive/10 border border-destructive/20 hover:border-destructive/50 text-destructive transition-colors cursor-pointer"
                  >
                    + Deny 0.0.0.0/0 (Block Rest)
                  </button>
                </div>
              </div>

              {/* ACL Rules Table / List */}
              {aclRules.length === 0 ? (
                <div className="p-6 text-center border border-dashed border-border/80 rounded-xl">
                  <p className="text-xs text-muted-foreground">
                    Chưa có quy tắc CIDR nào. Mọi IP đều được phép kết nối theo mặc định.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border/60 border border-border/70 rounded-xl overflow-hidden bg-background">
                  {aclRules.map((rule, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 text-xs hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {/* Priority Badge & Reorder Controls */}
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                            #{rule.priority}
                          </span>
                          <div className="flex flex-col -space-y-1">
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => handleMoveRule(idx, 'up')}
                              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                              title="Move Up (Higher Priority)"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              disabled={idx === aclRules.length - 1}
                              onClick={() => handleMoveRule(idx, 'down')}
                              className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                              title="Move Down (Lower Priority)"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Action Badge */}
                        <span
                          className={`font-mono text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                            rule.action === 'allow'
                              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                              : 'bg-destructive/10 text-destructive border-destructive/20'
                          }`}
                        >
                          {rule.action}
                        </span>

                        {/* CIDR */}
                        <span className="font-mono font-bold text-foreground">{rule.cidr}</span>

                        {rule.description && (
                          <span className="text-muted-foreground text-[11px] hidden sm:inline">
                            • {rule.description}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveACL(idx)}
                        className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors cursor-pointer"
                        title="Remove rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Section 4: Timeouts & Advanced */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs backdrop-blur-xs">
              <div className="flex items-center gap-2 pb-3 border-b border-border/70">
                <Clock className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">
                  4. Transport Timeouts
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Proxy Session Timeout
                  </label>
                  <input
                    type="text"
                    placeholder="1h, 30m, 60s"
                    value={proxyTimeout}
                    onChange={(e) => setProxyTimeout(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Max idle duration between two successive read/write ops (default: 1h).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Proxy Connect Timeout
                  </label>
                  <input
                    type="text"
                    placeholder="5s, 10s"
                    value={connectTimeout}
                    onChange={(e) => setConnectTimeout(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-background border border-border/80 rounded-lg text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/40"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Timeout for establishing raw connection with origin target (default: 5s).
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Sidebar Summary & Actions (4 Columns) */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            {/* Live Summary Card */}
            <div className="p-5 bg-card border border-border rounded-xl space-y-4 shadow-xs backdrop-blur-xs sticky top-6">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-2 border-b border-border/70">
                Service Configuration Summary
              </h3>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Service Name:</span>
                  <span className="font-semibold text-foreground truncate max-w-[160px]">
                    {name || '—'}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Listener:</span>
                  <span className="font-mono font-bold text-primary uppercase">
                    {protocol} :{port}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Routing Strategy:</span>
                  <span
                    className={`font-semibold uppercase text-[11px] px-2 py-0.5 rounded border ${
                      trafficAction === 'forward'
                        ? 'bg-primary/10 text-primary border-primary/20'
                        : 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                    }`}
                  >
                    {trafficAction === 'forward' ? 'Forward To' : 'Continue (L4→L7)'}
                  </span>
                </div>

                {trafficAction === 'forward' && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Destination:</span>
                    <span className="font-mono text-[11px] text-foreground font-medium truncate max-w-[160px]">
                      {targetType === 'upstream'
                        ? `Pool: ${upstream || 'None'}`
                        : `Direct: ${endpoint || 'None'}`}
                    </span>
                  </div>
                )}

                {trafficAction === 'continue' && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Destination:</span>
                    <span className="font-mono text-[11px] text-violet-400 font-semibold truncate max-w-[160px]">
                      L7 Route Engine
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Access Rules:</span>
                  <span className="font-mono text-foreground font-semibold">
                    {aclRules.length} active (by priority)
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Initial Status:</span>
                  <span
                    className={`inline-flex items-center gap-1 font-semibold text-[11px] ${
                      enabled ? 'text-emerald-500' : 'text-muted-foreground'
                    }`}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {enabled ? 'Active / Enabled' : 'Inactive'}
                  </span>
                </div>
              </div>

              {/* NGINX Stream Syntax Live Preview */}
              <div className="pt-3 border-t border-border/70 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <Code className="w-3.5 h-3.5 text-primary" />
                  <span>NGINX Stream Block Preview</span>
                </div>
                <pre className="p-2.5 rounded-lg bg-muted/60 border border-border/80 text-[10px] font-mono text-foreground overflow-x-auto leading-relaxed max-h-48">
                  {nginxPreview}
                </pre>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-border/70 space-y-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-4 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSubmitting ? 'Saving Changes...' : 'Save Changes'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/l4')}
                  disabled={isSubmitting}
                  className="w-full py-2 px-4 rounded-xl border border-border/80 bg-background hover:bg-muted text-foreground text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
