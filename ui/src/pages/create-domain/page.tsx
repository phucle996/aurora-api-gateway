import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Globe,
  Server,
  Shield,
  FileText,
  Lightbulb,
  Plus,
  Search,
  Check,
  ChevronDown,
  X,
} from 'lucide-react';
import type { DomainItem, TlsType } from '../domains/types';
import { policiesApi, type SavedPolicy } from '../../lib/api/policies';

export interface ProbeCheckItem {
  id: string;
  type: 'Readiness' | 'Liveness' | 'Health';
  path: string;
  expectedStatus?: number;
}

export default function CreateDomainPage() {
  const navigate = useNavigate();

  // 1. Basic Information
  const [domainName, setDomainName] = useState('');
  const [rootDomain, setRootDomain] = useState('');
  const [description, setDescription] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // 2. Upstream Configuration
  const [upstreamType, setUpstreamType] = useState<'Single Server' | 'Load Balancer' | 'External (FQDN)'>('Single Server');
  const [upstreamProtocol, setUpstreamProtocol] = useState<'http://' | 'https://'>('http://');
  const [upstreamHost, setUpstreamHost] = useState('');

  // Load Balancer state
  const [lbAlgorithm, setLbAlgorithm] = useState<'round_robin' | 'least_conn' | 'ip_hash'>('round_robin');
  const [lbServers, setLbServers] = useState<Array<{ id: string; address: string; weight: number }>>([
    { id: 'lb-1', address: '10.0.1.10:8080', weight: 1 },
    { id: 'lb-2', address: '10.0.1.11:8080', weight: 1 },
  ]);

  const handleAddLbServer = () => {
    setLbServers([
      ...lbServers,
      { id: `lb-${Date.now()}`, address: '', weight: 1 },
    ]);
  };

  const handleUpdateLbServer = (id: string, updates: Partial<{ address: string; weight: number }>) => {
    setLbServers(lbServers.map((s) => (s.id === id ? { ...s, ...updates } : s)));
  };

  const handleRemoveLbServer = (id: string) => {
    if (lbServers.length <= 1) return;
    setLbServers(lbServers.filter((s) => s.id !== id));
  };

  // External FQDN state
  const [externalFqdn, setExternalFqdn] = useState('');
  const [sniOverride, setSniOverride] = useState(true);
  const [dynamicDns, setDynamicDns] = useState(true);

  const [probes, setProbes] = useState<ProbeCheckItem[]>([
    { id: '1', type: 'Readiness', path: '/health', expectedStatus: 200 },
  ]);
  const [newProbePath, setNewProbePath] = useState('');
  const [newProbeType, setNewProbeType] = useState<'Readiness' | 'Liveness' | 'Health'>('Readiness');

  const handleAddProbe = () => {
    const trimmed = newProbePath.trim();
    if (!trimmed) return;
    const formatted = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    if (probes.some((p) => p.path === formatted)) return;
    setProbes([
      ...probes,
      {
        id: `probe-${Date.now()}`,
        type: newProbeType,
        path: formatted,
        expectedStatus: 200,
      },
    ]);
    setNewProbePath('');
  };

  const handleRemoveProbe = (id: string) => {
    setProbes(probes.filter((p) => p.id !== id));
  };
  // Transport & Protocols
  const [httpVersion, setHttpVersion] = useState<'HTTP/1.1' | 'HTTP/2' | 'HTTP/1.0'>('HTTP/1.1');
  const [enableWebSocket, setEnableWebSocket] = useState(false);
  const [enableSse, setEnableSse] = useState(false);
  const [enableGrpc, setEnableGrpc] = useState(false);

  const handleToggleGrpc = () => {
    const next = !enableGrpc;
    setEnableGrpc(next);
    if (next && httpVersion === 'HTTP/1.1') {
      setHttpVersion('HTTP/2');
    }
  };

  // 3. TLS / Security
  const [tlsMode, setTlsMode] = useState<TlsType>("Let's Encrypt");
  const [certificateEmail, setCertificateEmail] = useState('');
  const [tlsVersion, setTlsVersion] = useState<'TLS 1.2' | 'TLS 1.3'>('TLS 1.2');
  const [hstsEnabled, setHstsEnabled] = useState(true);
  const [additionalSans, setAdditionalSans] = useState('');

  // 4. WAF & Policy Binding
  const [availablePolicies, setAvailablePolicies] = useState<SavedPolicy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [policyDropdownOpen, setPolicyDropdownOpen] = useState(false);
  const [policySearch, setPolicySearch] = useState('');
  const [enableWaf, setEnableWaf] = useState(true);
  const [enableRateLimiting, setEnableRateLimiting] = useState(true);

  // Load policies
  useEffect(() => {
    policiesApi.list()
      .then((rows) => setAvailablePolicies(rows))
      .catch(() => {
        setAvailablePolicies([]);
      });
  }, []);

  // Auto-fill root domain when domain changes
  const handleDomainChange = (val: string) => {
    setDomainName(val);
    const trimmed = val.trim();
    const parts = trimmed.split('.');
    if (parts.length >= 2) {
      setRootDomain(parts.slice(-2).join('.'));
    } else {
      setRootDomain(trimmed);
    }
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = tagInput.trim().replace(/^,+|,+$/g, '');
      if (val && !tags.includes(val)) {
        setTags([...tags, val]);
      }
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainName.trim()) return;

    let currentDomains: DomainItem[] = [];
    try {
      const saved = localStorage.getItem('aurora_waf_domains');
      if (saved) currentDomains = JSON.parse(saved);
    } catch {
      // ignore
    }

    let fullUpstream = '';
    let upstreamServersList: Array<{ url: string; weight: number; maxFails: number; failTimeout: string; healthy: boolean }> = [];
    let algorithm: 'round_robin' | 'least_conn' | 'ip_hash' = 'round_robin';

    if (upstreamType === 'Load Balancer') {
      algorithm = lbAlgorithm;
      upstreamServersList = lbServers.map((s) => ({
        url: s.address.startsWith('http://') || s.address.startsWith('https://')
          ? s.address
          : `${upstreamProtocol}${s.address.trim() || '10.0.1.10:8080'}`,
        weight: s.weight || 1,
        maxFails: 3,
        failTimeout: '10s',
        healthy: true,
      }));
      fullUpstream = `${lbServers.length} servers (${lbAlgorithm.replace('_', ' ')})`;
    } else if (upstreamType === 'External (FQDN)') {
      const fqdn = externalFqdn.trim() || 'origin.backend.internal';
      fullUpstream = fqdn.startsWith('http://') || fqdn.startsWith('https://')
        ? fqdn
        : `${upstreamProtocol}${fqdn}`;
      upstreamServersList = [
        {
          url: fullUpstream,
          weight: 1,
          maxFails: 3,
          failTimeout: '10s',
          healthy: true,
        },
      ];
    } else {
      // Single Server
      fullUpstream = upstreamHost.trim()
        ? `${upstreamProtocol}${upstreamHost.trim()}`
        : `${upstreamProtocol}10.0.1.10:8080`;
      upstreamServersList = [
        {
          url: fullUpstream,
          weight: 1,
          maxFails: 3,
          failTimeout: '10s',
          healthy: true,
        },
      ];
    }

    const newDomain: DomainItem = {
      id: `dom-${Date.now()}`,
      domain: domainName.trim(),
      rootDomain: rootDomain.trim() || domainName.trim(),
      status: 'Active',
      tlsType: tlsMode,
      tlsExpiry: '2026-03-07',
      tlsAutoRenew: true,
      minTlsVersion: tlsVersion === 'TLS 1.3' ? 'TLSv1.3' : 'TLSv1.2',
      hstsEnabled,
      upstream: fullUpstream,
      upstreamAlgorithm: algorithm,
      healthCheckPath: probes.find((p) => p.type === 'Readiness')?.path || probes[0]?.path || '/health',
      upstreamServers: upstreamServersList,
      rulesCount: enableWaf ? 4 : 0,
      policiesCount: selectedPolicies.length,
      ipRulesCount: 0,
      rateLimitsCount: enableRateLimiting ? 2 : 0,
      tags,
      httpVersion,
      enableWebSocket,
      enableSse,
      enableGrpc,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      createdBy: 'admin',
      description: description.trim(),
    };

    const updated = [newDomain, ...currentDomains];
    try {
      localStorage.setItem('aurora_waf_domains', JSON.stringify(updated));
    } catch {
      // ignore
    }

    navigate('/domains');
  };

  const filteredPolicies = availablePolicies.filter((p) =>
    p.document.name.toLowerCase().includes(policySearch.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-6 w-full min-h-screen space-y-6 font-sans bg-background text-foreground">
      {/* ── Breadcrumb & Top Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Link to="/domains" className="hover:text-foreground transition-colors">
              Domains
            </Link>
            <span className="text-border">/</span>
            <span className="text-foreground font-medium">Add Domain</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Add Domain</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add a new domain or subdomain to manage its TLS, upstream and security settings.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/domains')}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md border border-border bg-card hover:bg-muted text-foreground text-xs font-medium transition-colors shadow-xs cursor-pointer w-fit"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Domains</span>
        </button>
      </div>

      {/* ── Main Form with 60-30-10 Layout (60% background, 30% structural cards, 10% green accent) ── */}
      <form onSubmit={handleCreate}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Form Cards (col-span-8) */}
          <div className="lg:col-span-8 space-y-5">
            {/* 1. Basic Information */}
            <div className="bg-card border border-border rounded-lg p-5 sm:p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/25">
                  1
                </span>
                <h2 className="text-sm font-bold text-foreground tracking-tight">
                  Basic Information
                </h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Domain Name <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. api.example.com"
                    value={domainName}
                    onChange={(e) => handleDomainChange(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Enter a domain or subdomain. Wildcard domains are supported (e.g. *.example.com).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Root Domain
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. example.com"
                    value={rootDomain}
                    onChange={(e) => setRootDomain(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Used for grouping and certificate management.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Description
                  </label>
                  <div className="relative">
                    <textarea
                      rows={3}
                      maxLength={500}
                      placeholder="Add a description (optional)..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary resize-none transition-colors pb-6"
                    />
                    <span className="absolute bottom-2 right-2.5 text-[10px] text-muted-foreground select-none pointer-events-none">
                      {description.length}/500
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Tags
                  </label>
                  <input
                    type="text"
                    placeholder="Type a tag and press Enter..."
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                  />
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {tags.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary border border-primary/25"
                        >
                          <span>{t}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveTag(t)}
                            className="hover:opacity-75 cursor-pointer ml-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 2. Upstream Configuration */}
            <div className="bg-card border border-border rounded-lg p-5 sm:p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/25">
                  2
                </span>
                <div>
                  <h2 className="text-sm font-bold text-foreground tracking-tight">
                    Upstream Configuration
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Define where to forward traffic for this domain.
                  </p>
                </div>
              </div>

              {/* Upstream Type Radio */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-semibold text-foreground">
                  Upstream Type
                </label>
                <div className="flex flex-wrap items-center gap-6 pt-1">
                  {(['Single Server', 'Load Balancer', 'External (FQDN)'] as const).map((type) => (
                    <label
                      key={type}
                      className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none"
                    >
                      <input
                        type="radio"
                        name="upstreamType"
                        value={type}
                        checked={upstreamType === type}
                        onChange={() => setUpstreamType(type)}
                        className="w-3.5 h-3.5 text-primary bg-background border-border focus:ring-primary accent-primary cursor-pointer"
                      />
                      <span className={upstreamType === type ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                        {type}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Dynamic Upstream Fields based on Upstream Type */}
              {upstreamType === 'Single Server' && (
                <div className="space-y-1.5 pt-1">
                  <label className="block text-xs font-semibold text-foreground">
                    Upstream Server <span className="text-destructive">*</span>
                  </label>
                  <div className="flex">
                    <select
                      value={upstreamProtocol}
                      onChange={(e) => setUpstreamProtocol(e.target.value as 'http://' | 'https://')}
                      className="bg-muted border border-border border-r-0 rounded-l-md px-2.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                    >
                      <option value="http://">http://</option>
                      <option value="https://">https://</option>
                    </select>
                    <input
                      type="text"
                      placeholder="e.g. 10.0.1.10:8080 or backend.example.com"
                      value={upstreamHost}
                      onChange={(e) => setUpstreamHost(e.target.value)}
                      className="flex-1 bg-background border border-border rounded-r-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors font-mono"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Direct forward proxy to a single internal backend server or container IP:Port.
                  </p>
                </div>
              )}

              {upstreamType === 'Load Balancer' && (
                <div className="space-y-4 pt-1">
                  {/* Load Balancing Algorithm */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-foreground">
                        Balancing Algorithm
                      </label>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        upstream policy: {lbAlgorithm}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[
                        {
                          id: 'round_robin' as const,
                          name: 'Round Robin',
                          desc: 'Distribute requests sequentially across healthy nodes',
                        },
                        {
                          id: 'least_conn' as const,
                          name: 'Least Connections',
                          desc: 'Forward to server with least active concurrent connections',
                        },
                        {
                          id: 'ip_hash' as const,
                          name: 'IP Hash (Sticky)',
                          desc: 'Hash client IP to bind clients consistently to same node',
                        },
                      ].map((alg) => (
                        <label
                          key={alg.id}
                          onClick={() => setLbAlgorithm(alg.id)}
                          className={`p-2.5 rounded-md border cursor-pointer transition-all select-none ${
                            lbAlgorithm === alg.id
                              ? 'bg-primary/10 border-primary/40 text-foreground ring-1 ring-primary/30'
                              : 'bg-background hover:bg-muted/40 border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <span className={`text-xs font-bold block ${lbAlgorithm === alg.id ? 'text-primary' : 'text-foreground'}`}>
                            {alg.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-0.5 block leading-snug">
                            {alg.desc}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Backend Servers Pool List */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-foreground">
                        Backend Servers Pool <span className="text-destructive">*</span>
                      </label>
                      <span className="text-[10px] font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border">
                        {lbServers.length} nodes
                      </span>
                    </div>

                    <div className="space-y-2">
                      {lbServers.map((server, index) => (
                        <div
                          key={server.id}
                          className="flex items-center gap-2 p-2 bg-background/70 border border-border rounded-md"
                        >
                          <span className="text-xs font-mono text-muted-foreground w-6 text-center">
                            #{index + 1}
                          </span>

                          <div className="flex flex-1">
                            <span className="bg-muted border border-border border-r-0 rounded-l-md px-2.5 py-1.5 text-xs font-medium text-foreground">
                              {upstreamProtocol}
                            </span>
                            <input
                              type="text"
                              placeholder="e.g. 10.0.1.10:8080"
                              value={server.address}
                              onChange={(e) => handleUpdateLbServer(server.id, { address: e.target.value })}
                              className="flex-1 bg-background border border-border rounded-r-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                            />
                          </div>

                          <div className="flex items-center gap-1.5 w-24 shrink-0">
                            <span className="text-[10px] text-muted-foreground">Weight:</span>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={server.weight}
                              onChange={(e) => handleUpdateLbServer(server.id, { weight: Number(e.target.value) || 1 })}
                              className="w-12 bg-background border border-border rounded px-2 py-1.5 text-xs text-center font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>

                          <button
                            type="button"
                            disabled={lbServers.length <= 1}
                            onClick={() => handleRemoveLbServer(server.id)}
                            className="p-1.5 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground cursor-pointer transition-colors"
                            title="Remove server"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={handleAddLbServer}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/25 rounded-md text-xs font-semibold cursor-pointer transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Backend Server</span>
                    </button>
                  </div>
                </div>
              )}

              {upstreamType === 'External (FQDN)' && (
                <div className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-foreground">
                      External Hostname / FQDN <span className="text-destructive">*</span>
                    </label>
                    <div className="flex">
                      <select
                        value={upstreamProtocol}
                        onChange={(e) => setUpstreamProtocol(e.target.value as 'http://' | 'https://')}
                        className="bg-muted border border-border border-r-0 rounded-l-md px-2.5 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                      >
                        <option value="https://">https://</option>
                        <option value="http://">http://</option>
                      </select>
                      <input
                        type="text"
                        placeholder="e.g. origin-alb.us-east-1.elb.amazonaws.com or api.partner.net"
                        value={externalFqdn}
                        onChange={(e) => setExternalFqdn(e.target.value)}
                        className="flex-1 bg-background border border-border rounded-r-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors font-mono"
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Public or external cloud load balancer Fully Qualified Domain Name.
                    </p>
                  </div>

                  {/* FQDN Advanced Directives */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {/* SNI Host Override */}
                    <div className="flex items-start gap-2.5 p-3 rounded-md bg-background/60 border border-border">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={sniOverride}
                        onClick={() => setSniOverride(!sniOverride)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none mt-0.5 ${
                          sniOverride ? 'bg-primary border-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                            sniOverride ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <div>
                        <span className="text-xs font-semibold text-foreground block">
                          Pass SNI / Upstream Host
                        </span>
                        <span className="text-[10px] text-muted-foreground block mt-0.5 leading-snug">
                          Sets <code>proxy_ssl_server_name on;</code> and forwards origin FQDN as Host header.
                        </span>
                      </div>
                    </div>

                    {/* Dynamic DNS Resolver */}
                    <div className="flex items-start gap-2.5 p-3 rounded-md bg-background/60 border border-border">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={dynamicDns}
                        onClick={() => setDynamicDns(!dynamicDns)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none mt-0.5 ${
                          dynamicDns ? 'bg-primary border-primary' : 'bg-muted'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                            dynamicDns ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <div>
                        <span className="text-xs font-semibold text-foreground block">
                          Dynamic DNS Re-resolution
                        </span>
                        <span className="text-[10px] text-muted-foreground block mt-0.5 leading-snug">
                          Periodically resolves FQDN to prevent stale IPs on dynamic cloud providers.
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Probe & Health Checks */}
              <div className="space-y-3 pt-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-foreground">
                      Probe & Health Checks
                    </label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Configure endpoint probe paths for upstream readiness routing and liveness monitoring.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border">
                    {probes.length} probe{probes.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Existing Probes List */}
                {probes.length > 0 && (
                  <div className="space-y-1.5">
                    {probes.map((probe) => (
                      <div
                        key={probe.id}
                        className="flex items-center justify-between px-3 py-2 bg-background border border-border rounded-md text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                              probe.type === 'Readiness'
                                ? 'bg-primary/10 text-primary border border-primary/25'
                                : probe.type === 'Liveness'
                                ? 'bg-secondary/10 text-secondary border border-secondary/25'
                                : 'bg-muted text-muted-foreground border border-border'
                            }`}
                          >
                            {probe.type}
                          </span>
                          <span className="font-mono text-foreground font-medium">{probe.path}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            → {probe.expectedStatus || 200} OK
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveProbe(probe.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1 cursor-pointer"
                          title="Remove probe"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add New Probe Row */}
                <div className="flex items-center gap-2 pt-1">
                  <select
                    value={newProbeType}
                    onChange={(e) => setNewProbeType(e.target.value as any)}
                    className="bg-card border border-border text-foreground px-2.5 py-2 text-xs rounded-md focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer shrink-0 font-medium"
                  >
                    <option value="Readiness">Readiness Probe</option>
                    <option value="Liveness">Liveness Probe</option>
                    <option value="Health">Health Check</option>
                  </select>
                  <input
                    type="text"
                    placeholder="e.g. /health, /ready, /live"
                    value={newProbePath}
                    onChange={(e) => setNewProbePath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddProbe();
                      }
                    }}
                    className="flex-1 bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddProbe}
                    className="px-3.5 py-2 bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 text-xs font-semibold rounded-md transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Probe</span>
                  </button>
                </div>
              </div>

              {/* Transport & Protocols */}
              <div className="pt-4 border-t border-border space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground">
                    Transport & Protocols
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Configure upstream HTTP protocol version and advanced streaming communication options.
                  </p>
                </div>

                {/* HTTP Version Selector */}
                <div className="space-y-1.5 bg-background/60 p-3.5 rounded-md border border-border">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      Upstream HTTP Version
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Active: {httpVersion}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                    {[
                      {
                        ver: 'HTTP/1.1' as const,
                        label: 'HTTP/1.1',
                        badge: 'Default',
                        desc: 'Standard persistent connection pooling',
                      },
                      {
                        ver: 'HTTP/2' as const,
                        label: 'HTTP/2',
                        badge: 'Multiplexed',
                        desc: 'Multiplexed streams & native gRPC support',
                      },
                      {
                        ver: 'HTTP/1.0' as const,
                        label: 'HTTP/1.0',
                        badge: 'Legacy',
                        desc: 'Non-persistent simple request-reply',
                      },
                    ].map((opt) => (
                      <label
                        key={opt.ver}
                        onClick={() => setHttpVersion(opt.ver)}
                        className={`flex flex-col p-2.5 rounded-md border cursor-pointer transition-all select-none ${
                          httpVersion === opt.ver
                            ? 'bg-primary/10 border-primary/40 text-foreground ring-1 ring-primary/30'
                            : 'bg-card hover:bg-muted/50 border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${httpVersion === opt.ver ? 'text-primary' : 'text-foreground'}`}>
                            {opt.label}
                          </span>
                          <span
                            className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                              httpVersion === opt.ver
                                ? 'bg-primary/20 text-primary font-semibold'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {opt.badge}
                          </span>
                        </div>
                        <span className="text-[10px] text-muted-foreground mt-1 leading-snug">
                          {opt.desc}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Real-time Streaming & Protocol Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* WebSocket */}
                  <div className="flex items-start gap-2.5 p-3 rounded-md bg-background/60 border border-border">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enableWebSocket}
                      onClick={() => setEnableWebSocket(!enableWebSocket)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none mt-0.5 ${
                        enableWebSocket ? 'bg-primary border-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          enableWebSocket ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <span className="text-xs font-semibold text-foreground block">WebSocket</span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5 leading-snug">
                        RFC 6455 upgrade for real-time duplex sockets.
                      </span>
                    </div>
                  </div>

                  {/* Server-Sent Events (SSE) */}
                  <div className="flex items-start gap-2.5 p-3 rounded-md bg-background/60 border border-border">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enableSse}
                      onClick={() => setEnableSse(!enableSse)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none mt-0.5 ${
                        enableSse ? 'bg-primary border-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          enableSse ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <span className="text-xs font-semibold text-foreground block">Server-Sent Events</span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5 leading-snug">
                        Bypasses proxy buffering for instant AI streaming.
                      </span>
                    </div>
                  </div>

                  {/* gRPC Proxying */}
                  <div className="flex items-start gap-2.5 p-3 rounded-md bg-background/60 border border-border">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enableGrpc}
                      onClick={handleToggleGrpc}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none mt-0.5 ${
                        enableGrpc ? 'bg-primary border-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          enableGrpc ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <span className="text-xs font-semibold text-foreground block">gRPC (HTTP/2)</span>
                      <span className="text-[10px] text-muted-foreground block mt-0.5 leading-snug">
                        Native HTTP/2 frame forwarding for microservices.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. TLS / Security */}
            <div className="bg-card border border-border rounded-lg p-5 sm:p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/25">
                  3
                </span>
                <div>
                  <h2 className="text-sm font-bold text-foreground tracking-tight">
                    TLS / Security
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Configure TLS certificate and security settings.
                  </p>
                </div>
              </div>

              {/* TLS Mode Radio */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-semibold text-foreground">
                  TLS Mode
                </label>
                <div className="flex flex-wrap items-center gap-6 pt-1">
                  {(["Let's Encrypt (Auto)", 'Custom Certificate', 'Self-signed', 'mTLS (Client Cert)'] as const).map(
                    (mode) => {
                      const modeValue: TlsType =
                        mode === "Let's Encrypt (Auto)"
                          ? "Let's Encrypt"
                          : mode === 'Custom Certificate'
                          ? 'Custom Cert'
                          : mode === 'Self-signed'
                          ? 'Self-signed'
                          : 'mTLS';
                      return (
                        <label
                          key={mode}
                          className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none"
                        >
                          <input
                            type="radio"
                            name="tlsMode"
                            value={mode}
                            checked={tlsMode === modeValue}
                            onChange={() => setTlsMode(modeValue)}
                            className="w-3.5 h-3.5 text-primary bg-background border-border focus:ring-primary accent-primary cursor-pointer"
                          />
                          <span className={tlsMode === modeValue ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                            {mode}
                          </span>
                        </label>
                      );
                    }
                  )}
                </div>
              </div>

              {/* TLS Detailed Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-5 pt-1 items-start">
                <div className="lg:col-span-4">
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Email for Certificate <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. admin@example.com"
                    value={certificateEmail}
                    onChange={(e) => setCertificateEmail(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Used for Let's Encrypt notifications.
                  </p>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    TLS Version (Min)
                  </label>
                  <select
                    value={tlsVersion}
                    onChange={(e) => setTlsVersion(e.target.value as 'TLS 1.2' | 'TLS 1.3')}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors cursor-pointer"
                  >
                    <option value="TLS 1.2">TLS 1.2</option>
                    <option value="TLS 1.3">TLS 1.3</option>
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Minimum allowed TLS version.
                  </p>
                </div>

                <div className="lg:col-span-2">
                  <label className="block text-xs font-semibold text-foreground mb-2">
                    HSTS
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hstsEnabled}
                      onClick={() => setHstsEnabled(!hstsEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none ${
                        hstsEnabled ? 'bg-primary border-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          hstsEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-[11px] text-muted-foreground leading-tight">
                      Enable HTTP Strict Transport Security
                    </span>
                  </div>
                </div>

                <div className="lg:col-span-4">
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Additional SANs (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. www.example.com"
                    value={additionalSans}
                    onChange={(e) => setAdditionalSans(e.target.value)}
                    className="w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Add additional subject alternative names (one per line).
                  </p>
                </div>
              </div>
            </div>

            {/* 4. WAF & Policy Binding */}
            <div className="bg-card border border-border rounded-lg p-5 sm:p-6 space-y-4 shadow-xs">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold bg-primary/10 text-primary border border-primary/25">
                  4
                </span>
                <div>
                  <h2 className="text-sm font-bold text-foreground tracking-tight">
                    WAF & Policy Binding
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Choose which security policies apply to this domain.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center pt-1">
                {/* Policy Search & Selector */}
                <div className="md:col-span-6 relative">
                  <label className="block text-xs font-semibold text-foreground mb-1.5">
                    Apply Existing Policies (Optional)
                  </label>
                  <div
                    onClick={() => setPolicyDropdownOpen(!policyDropdownOpen)}
                    className="flex items-center justify-between w-full bg-background border border-border rounded-md px-3 py-2 text-xs text-foreground cursor-pointer hover:border-primary transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      {selectedPolicies.length > 0 ? (
                        <span className="truncate font-medium text-foreground">{selectedPolicies.join(', ')}</span>
                      ) : (
                        <span className="text-muted-foreground">Search and select policies...</span>
                      )}
                    </div>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-2" />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Selected policies will be applied to this domain.
                  </p>

                  {/* Dropdown Menu */}
                  {policyDropdownOpen && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-lg p-2 max-h-56 overflow-y-auto space-y-1">
                      <input
                        type="text"
                        placeholder="Search policy name..."
                        value={policySearch}
                        onChange={(e) => setPolicySearch(e.target.value)}
                        className="w-full bg-background border border-border rounded px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground mb-1 focus:outline-none focus:border-primary"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {filteredPolicies.length === 0 ? (
                        <div className="text-xs text-muted-foreground p-2 text-center">
                          No policies found
                        </div>
                      ) : (
                        filteredPolicies.map((p) => {
                          const isSelected = selectedPolicies.includes(p.document.name);
                          return (
                            <div
                              key={p.id}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedPolicies(selectedPolicies.filter((n) => n !== p.document.name));
                                } else {
                                  setSelectedPolicies([...selectedPolicies, p.document.name]);
                                }
                              }}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                                isSelected ? 'bg-primary/15 text-primary font-semibold' : 'hover:bg-muted text-foreground'
                              }`}
                            >
                              <span>{p.document.name}</span>
                              {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* Right: WAF & Rate Limiting Toggles */}
                <div className="md:col-span-6 flex flex-wrap items-center gap-8">
                  {/* Enable WAF */}
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enableWaf}
                      onClick={() => setEnableWaf(!enableWaf)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none ${
                        enableWaf ? 'bg-primary border-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          enableWaf ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <span className="text-xs font-medium text-foreground block">Enable WAF</span>
                      <span className="text-[10px] text-muted-foreground block">Apply WAF inspection to this domain</span>
                    </div>
                  </div>

                  {/* Enable Rate Limiting */}
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enableRateLimiting}
                      onClick={() => setEnableRateLimiting(!enableRateLimiting)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-border transition-colors duration-200 ease-in-out focus:outline-none ${
                        enableRateLimiting ? 'bg-primary border-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          enableRateLimiting ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <div>
                      <span className="text-xs font-medium text-foreground block">Enable Rate Limiting</span>
                      <span className="text-[10px] text-muted-foreground block">Use rate limiting rules</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Form Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => navigate('/domains')}
                className="px-4 py-2 border border-border bg-card hover:bg-muted text-foreground text-xs font-medium rounded-md transition-colors cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={!domainName.trim()}
                className="inline-flex items-center gap-1.5 px-5 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md shadow-xs transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create Domain</span>
              </button>
            </div>
          </div>

          {/* Right Column: Sticky Preview & Tips (col-span-4) */}
          <div className="lg:col-span-4 space-y-5 sticky top-6">
            {/* Domain Preview Card */}
            <div className="bg-card border border-border rounded-lg p-5 space-y-4 shadow-xs">
              <div>
                <h3 className="text-xs font-bold text-foreground tracking-tight">Domain Preview</h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Here is a summary of the domain configuration.
                </p>
              </div>

              {/* Sub-block 1: Domain */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <div className="w-5 h-5 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                    <Globe className="w-3 h-3" />
                  </div>
                  <span>Domain</span>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Domain Name</span>
                    <span className="font-medium text-foreground text-right">{domainName || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Root Domain</span>
                    <span className="font-medium text-foreground text-right">{rootDomain || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Description</span>
                    <span className="font-medium text-foreground text-right truncate max-w-[150px]">
                      {description || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Tags</span>
                    <span className="font-medium text-foreground text-right truncate max-w-[150px]">
                      {tags.length > 0 ? tags.join(', ') : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sub-block 2: Upstream */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <div className="w-5 h-5 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                    <Server className="w-3 h-3" />
                  </div>
                  <span>Upstream</span>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Type</span>
                    <span className="font-medium text-foreground">{upstreamType || '-'}</span>
                  </div>
                  {upstreamType === 'Load Balancer' ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Algorithm</span>
                        <span className="font-medium text-foreground capitalize">
                          {lbAlgorithm.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Servers</span>
                        <span className="font-medium text-foreground text-right truncate max-w-[150px]">
                          {lbServers.length} nodes ({lbServers.map((s) => s.address || 'node').join(', ')})
                        </span>
                      </div>
                    </>
                  ) : upstreamType === 'External (FQDN)' ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">FQDN</span>
                      <span className="font-medium text-foreground truncate max-w-[150px]">
                        {externalFqdn ? `${upstreamProtocol}${externalFqdn}` : '-'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Server</span>
                      <span className="font-medium text-foreground truncate max-w-[150px]">
                        {upstreamHost ? `${upstreamProtocol}${upstreamHost}` : '-'}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HTTP Version</span>
                    <span className="font-mono text-xs font-semibold text-foreground">{httpVersion}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Protocols</span>
                    <span className="font-medium text-foreground text-right truncate max-w-[150px]">
                      {[
                        enableWebSocket && 'WebSocket',
                        enableSse && 'SSE',
                        enableGrpc && 'gRPC',
                      ].filter(Boolean).join(', ') || 'Standard'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Probes / Health</span>
                    <span className="font-medium text-foreground text-right truncate max-w-[150px]">
                      {probes.length > 0 ? probes.map((p) => p.path).join(', ') : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sub-block 3: TLS / Security */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <div className="w-5 h-5 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                    <Shield className="w-3 h-3" />
                  </div>
                  <span>TLS / Security</span>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">TLS Mode</span>
                    <span className="font-medium text-foreground">{tlsMode || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">TLS Version</span>
                    <span className="font-medium text-foreground">{tlsVersion || '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">HSTS</span>
                    <span className={`font-medium ${hstsEnabled ? 'text-primary' : 'text-muted-foreground'}`}>
                      {hstsEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sub-block 4: WAF & Policies */}
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <div className="w-5 h-5 rounded bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
                    <FileText className="w-3 h-3" />
                  </div>
                  <span>WAF & Policies</span>
                </div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">WAF</span>
                    <span className={`font-medium ${enableWaf ? 'text-primary' : 'text-muted-foreground'}`}>
                      {enableWaf ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Rate Limiting</span>
                    <span className={`font-medium ${enableRateLimiting ? 'text-primary' : 'text-muted-foreground'}`}>
                      {enableRateLimiting ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Policies</span>
                    <span className="font-medium text-foreground truncate max-w-[150px]">
                      {selectedPolicies.length > 0 ? selectedPolicies.join(', ') : '-'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tips Card */}
            <div className="bg-card border border-border rounded-lg p-5 space-y-3 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Lightbulb className="w-4 h-4 text-primary" />
                <span>Tips</span>
              </div>
              <ul className="space-y-2 text-[11px] text-muted-foreground list-disc pl-4 leading-relaxed">
                <li>Use a dedicated subdomain for each service (e.g. api.example.com).</li>
                <li>Let's Encrypt certificates are automatically renewed.</li>
                <li>You can attach security policies later from the domain detail page.</li>
                <li>Changes will be deployed to all connected NGINX nodes automatically.</li>
              </ul>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
